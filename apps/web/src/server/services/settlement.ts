import 'server-only';
import type { DateTime } from 'luxon';
import {
    calculateDailyBudget,
    settleBlock,
    type ActiveBlockSnapshot,
    type BudgetOccupant,
    type SettlementTrigger,
    type TimeLogDraft,
} from '@nfs/domain';
import {
    dateColumnToDateString,
    dateStringToDateColumn,
    instantFromColumn,
    instantToColumn,
} from '@nfs/domain/time';
import { prisma } from '../prisma';
import { loadDayOccupants } from './day-occupants';

/**
 * 이관 트랜잭션 (B-06 · 데이터모델 §3.1) ⭐⭐
 *
 * 가변 작업 영역(`ActiveBlock`)이 불변 원장(`TimeLog`)으로 넘어가는 지점.
 * **되돌릴 수 없다.**
 *
 * 처리 순서
 *   1. 블록을 읽어 도메인 스냅샷으로 바꾼다
 *   2. 정산 값을 계산한다 (완료 유형 · 집중 시간 · 시작/종료) — 순수 함수
 *   3. 겹침 차감을 구한다 — **예산 계산기를 그대로 재사용한다**
 *   4. TimeLog INSERT  (중복이면 조용히 건너뛴다)
 *   5. ActiveBlock DELETE
 *
 * ⭐ **4번이 먼저, 5번이 나중이다.**
 *    중간에 끊겨도 원본이 남아 재시도할 수 있고, 재시도해도 UNIQUE 가 중복을 막는다.
 *    반대 순서면 기록이 유실된다.
 */

export interface SettlementResult {
    activeBlockId: string;
    /** 이미 정산돼 있었으면 false. 호출부는 두 경우를 구분하지 않아도 된다 */
    inserted: boolean;
    draft: TimeLogDraft;
    overlapDeductedMinutes: number;
}

interface ActiveBlockRow {
    activeBlockId: bigint;
    title: string;
    categoryTag: ActiveBlockSnapshot['categoryTag'];
    blockStatus: ActiveBlockSnapshot['blockStatus'];
    plannedStartTime: Date;
    plannedMinutes: number;
    actualStartTime: Date | null;
    accumulatedFocusSeconds: number;
    lastResumedTime: Date | null;
    pauseCount: number;
    workDate: Date;
}

function toSnapshot(row: ActiveBlockRow): ActiveBlockSnapshot {
    return {
        activeBlockId: row.activeBlockId.toString(),
        title: row.title,
        categoryTag: row.categoryTag,
        blockStatus: row.blockStatus,
        plannedStartTime: instantFromColumn(row.plannedStartTime),
        plannedMinutes: row.plannedMinutes,
        actualStartTime: row.actualStartTime === null ? null : instantFromColumn(row.actualStartTime),
        accumulatedFocusSeconds: row.accumulatedFocusSeconds,
        lastResumedTime: row.lastResumedTime === null ? null : instantFromColumn(row.lastResumedTime),
        pauseCount: row.pauseCount,
        workDate: dateColumnToDateString(row.workDate),
    };
}

/**
 * 정산될 구간이 다른 일정과 얼마나 겹치는지 구한다. (테스트계획 #20)
 *
 * ⭐ **예산 계산기를 그대로 쓴다.** 겹침 규칙을 여기서 다시 구현하면
 *    "하루 화면의 남은 시간"과 "원장의 겹침 차감"이 서로 다른 답을 내게 된다.
 *
 * 이관 중인 블록은 점유자 목록에서 빼고, **정산된 구간**(조기 완료면 짧아진 구간)으로
 * 다시 넣는다. 계획 구간으로 재면 실제보다 많이 겹친 것으로 잡힌다.
 */
async function computeOverlapMinutes(
    memberId: bigint,
    snapshot: ActiveBlockSnapshot,
    draft: TimeLogDraft,
): Promise<number> {
    const others = await loadDayOccupants(memberId, snapshot.workDate, {
        excludeActiveBlockId: BigInt(snapshot.activeBlockId),
    });

    const settledOccupant: BudgetOccupant = {
        referenceKey: `settling:${snapshot.activeBlockId}`,
        sourceType: 'NFS_BLOCK',
        categoryTag: draft.categoryTag,
        title: draft.title,
        startTime: draft.startTime,
        endTime: draft.endTime,
    };

    const result = calculateDailyBudget({
        workDate: snapshot.workDate,
        occupants: [...others, settledOccupant],
    });

    for (const attribution of result.occupants) {
        if (attribution.referenceKey === settledOccupant.referenceKey) {
            return attribution.overlapDeductedMinutes;
        }
    }
    // 그날에 안 걸치는 블록이면 점유 목록에서 빠진다. 겹침도 0이다
    return 0;
}

/**
 * 블록 하나를 정산한다.
 *
 * 블록이 이미 없으면 `null` 을 돌려준다 — **예외를 던지지 않는다.**
 * 자정 배치와 사용자 완료가 같은 블록을 동시에 집으면 한쪽은 반드시 빈손이 되는데,
 * 그건 정상 동작이지 오류가 아니다.
 */
export async function settleActiveBlock(
    memberId: bigint,
    activeBlockId: bigint,
    now: DateTime,
    trigger: SettlementTrigger,
): Promise<SettlementResult | null> {
    const row = await prisma.activeBlock.findFirst({
        // ⚠️ memberId 조건을 반드시 건다. URL 의 id 를 신뢰하지 않는다 (아키텍처 §9)
        where: { activeBlockId: activeBlockId, memberId: memberId },
    });

    if (row === null) {
        return null;
    }

    const snapshot = toSnapshot(row);
    const draft = settleBlock(snapshot, now, trigger);
    const overlapDeductedMinutes = await computeOverlapMinutes(memberId, snapshot, draft);

    const inserted = await prisma.$transaction(async function transferToLedger(tx) {
        // 4. INSERT — 이미 있으면 건너뛴다.
        //    createMany + skipDuplicates 는 ON CONFLICT DO NOTHING 으로 나간다.
        //    create 로 하면 UNIQUE 위반이 예외가 되고, 트랜잭션 안에서 예외가 나면
        //    그 트랜잭션은 통째로 죽어 5번(DELETE)을 같이 못 하게 된다.
        const insertResult = await tx.timeLog.createMany({
            data: [
                {
                    memberId: memberId,
                    sourceType: draft.sourceType,
                    sourceReferenceKey: draft.sourceReferenceKey,
                    title: draft.title,
                    categoryTag: draft.categoryTag,
                    statDate: dateStringToDateColumn(draft.statDate),
                    startTime: instantToColumn(draft.startTime),
                    endTime: instantToColumn(draft.endTime),
                    plannedMinutes: draft.plannedMinutes,
                    actualFocusMinutes: draft.actualFocusMinutes,
                    overlapDeductedMinutes: overlapDeductedMinutes,
                    completionType: draft.completionType,
                    pauseCount: draft.pauseCount,
                },
            ],
            skipDuplicates: true,
        });

        // 5. DELETE — deleteMany 라 이미 없어도 예외가 나지 않는다.
        //    delete 였다면 재시도 때 P2025 가 나서 멱등성이 깨진다.
        await tx.activeBlock.deleteMany({
            where: { activeBlockId: activeBlockId, memberId: memberId },
        });

        return insertResult.count > 0;
    });

    return {
        activeBlockId: snapshot.activeBlockId,
        inserted: inserted,
        draft: draft,
        overlapDeductedMinutes: overlapDeductedMinutes,
    };
}

/**
 * 자정 배치용 — 그날 남아 있는 블록을 전부 정산한다. (B-08)
 *
 * 한 블록의 실패가 나머지를 막지 않는다. 실패한 것만 모아 보고한다.
 */
export interface BatchSettlementResult {
    settledCount: number;
    skippedCount: number;
    failedBlockIds: string[];
}

export async function settleAllBlocksOfDate(
    memberId: bigint,
    workDate: string,
    now: DateTime,
    trigger: SettlementTrigger,
): Promise<BatchSettlementResult> {
    const rows = await prisma.activeBlock.findMany({
        where: { memberId: memberId, workDate: dateStringToDateColumn(workDate) },
        select: { activeBlockId: true },
    });

    let settledCount = 0;
    let skippedCount = 0;
    const failedBlockIds: string[] = [];

    for (const row of rows) {
        try {
            const result = await settleActiveBlock(memberId, row.activeBlockId, now, trigger);

            if (result === null) {
                skippedCount = skippedCount + 1;
                continue;
            }
            if (result.inserted) {
                settledCount = settledCount + 1;
            } else {
                skippedCount = skippedCount + 1;
            }
        } catch (caught) {
            console.error('[nfs] settlement failed', row.activeBlockId.toString(), caught);
            failedBlockIds.push(row.activeBlockId.toString());
        }
    }

    return {
        settledCount: settledCount,
        skippedCount: skippedCount,
        failedBlockIds: failedBlockIds,
    };
}
