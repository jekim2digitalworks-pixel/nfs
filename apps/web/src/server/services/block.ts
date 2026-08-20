import 'server-only';
import type { DateTime } from 'luxon';
import {
    assertBlockFitsInBudget,
    calculateDailyBudget,
    createBlock as createBlockSnapshot,
    focusSecondsAt,
    pauseBlock as pauseBlockSnapshot,
    resumeBlock as resumeBlockSnapshot,
    startBlock as startBlockSnapshot,
    type ActiveBlockSnapshot,
    type BudgetOccupant,
    type CategoryTag,
    type SettlementTrigger,
} from '@nfs/domain';
import {
    dateColumnToDateString,
    dateStringToDateColumn,
    instantFromColumn,
    instantToColumn,
    workDateOf,
} from '@nfs/domain/time';
import { prisma } from '../prisma';
import { loadDayOccupants } from './day-occupants';
import { settleActiveBlock, type SettlementResult } from './settlement';

/**
 * 블록 생명주기 서비스 (B-04)
 *
 * ⭐ **판단은 전부 `packages/domain` 이 한다.** 이 파일은 읽고 · 넘기고 · 저장할 뿐이다.
 *    상태 전이 조건을 여기서 다시 쓰면 같은 판단이 API 와 배치 두 군데에 생긴다.
 */

interface ActiveBlockRow {
    activeBlockId: bigint;
    title: string;
    categoryTag: CategoryTag;
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

export interface BlockView {
    activeBlockId: string;
    title: string;
    categoryTag: CategoryTag;
    blockStatus: ActiveBlockSnapshot['blockStatus'];
    plannedStartTime: string;
    plannedMinutes: number;
    focusSeconds: number;
    pauseCount: number;
    /** ⭐ 클라이언트 타이머가 이 값으로 재동기화한다 (퍼블 §4.2) */
    serverTime: string;
}

function toView(snapshot: ActiveBlockSnapshot, now: DateTime): BlockView {
    return {
        activeBlockId: snapshot.activeBlockId,
        title: snapshot.title,
        categoryTag: snapshot.categoryTag,
        blockStatus: snapshot.blockStatus,
        plannedStartTime: snapshot.plannedStartTime.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
        plannedMinutes: snapshot.plannedMinutes,
        focusSeconds: focusSecondsAt(snapshot, now),
        pauseCount: snapshot.pauseCount,
        serverTime: now.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    };
}

export interface CreateBlockCommand {
    categoryTag: CategoryTag;
    title: string;
    plannedStartTime: DateTime;
    plannedMinutes: number;
    startImmediately: boolean;
}

/**
 * 블록을 만든다.
 *
 * 검증 순서 (API명세 §2): 태그 → 길이 → 격자 정렬 → **예산 초과**
 * 앞의 셋은 도메인이 순수 함수로 하고, 예산만 DB 를 읽어야 해서 여기서 한다.
 */
export async function createBlock(
    memberId: bigint,
    command: CreateBlockCommand,
    now: DateTime,
): Promise<BlockView> {
    // id 는 DB 가 준다. 도메인 검증에는 값이 필요 없으므로 자리만 채운다
    const validated = createBlockSnapshot(
        {
            activeBlockId: '0',
            title: command.title,
            categoryTag: command.categoryTag,
            plannedStartTime: command.plannedStartTime,
            plannedMinutes: command.plannedMinutes,
            startImmediately: command.startImmediately,
        },
        now,
    );

    // 예산 검증 — 자정을 넘는 블록은 **각 날짜를 따로** 본다 (정책 §2.3).
    // 한 날만 보면 23:00–01:00 블록이 다음 날 예산을 무시하고 들어간다.
    const plannedEnd = command.plannedStartTime.plus({ minutes: command.plannedMinutes });
    const affectedDates = new Set<string>([
        workDateOf(command.plannedStartTime),
        workDateOf(plannedEnd.minus({ seconds: 1 })),
    ]);

    for (const workDate of affectedDates) {
        const occupants = await loadDayOccupants(memberId, workDate);
        const budget = calculateDailyBudget({ workDate: workDate, occupants: occupants });

        assertBlockFitsInBudget(budget, {
            referenceKey: 'new',
            sourceType: 'NFS_BLOCK',
            categoryTag: validated.categoryTag,
            title: validated.title,
            startTime: validated.plannedStartTime,
            endTime: plannedEnd,
        });
    }

    const created = await prisma.activeBlock.create({
        data: {
            memberId: memberId,
            title: validated.title,
            categoryTag: validated.categoryTag,
            blockStatus: validated.blockStatus,
            plannedStartTime: instantToColumn(validated.plannedStartTime),
            plannedMinutes: validated.plannedMinutes,
            actualStartTime:
                validated.actualStartTime === null ? null : instantToColumn(validated.actualStartTime),
            accumulatedFocusSeconds: validated.accumulatedFocusSeconds,
            lastResumedTime:
                validated.lastResumedTime === null ? null : instantToColumn(validated.lastResumedTime),
            pauseCount: validated.pauseCount,
            workDate: dateStringToDateColumn(validated.workDate),
        },
    });

    return toView(toSnapshot(created), now);
}

/** 상태 전이 세 가지는 모양이 같다. 도메인 함수만 갈아 끼운다 */
type TransitionFn = (block: ActiveBlockSnapshot, now: DateTime) => ActiveBlockSnapshot;

async function applyTransition(
    memberId: bigint,
    activeBlockId: bigint,
    now: DateTime,
    transition: TransitionFn,
): Promise<BlockView | null> {
    const row = await prisma.activeBlock.findFirst({
        where: { activeBlockId: activeBlockId, memberId: memberId },
    });

    if (row === null) {
        return null;
    }

    // 전이 가능 여부는 도메인이 판단한다. 불가능하면 여기서 예외가 올라간다
    const next = transition(toSnapshot(row), now);

    const updated = await prisma.activeBlock.update({
        where: { activeBlockId: activeBlockId },
        data: {
            blockStatus: next.blockStatus,
            actualStartTime: next.actualStartTime === null ? null : instantToColumn(next.actualStartTime),
            accumulatedFocusSeconds: next.accumulatedFocusSeconds,
            lastResumedTime: next.lastResumedTime === null ? null : instantToColumn(next.lastResumedTime),
            pauseCount: next.pauseCount,
        },
    });

    return toView(toSnapshot(updated), now);
}

export async function startBlock(memberId: bigint, activeBlockId: bigint, now: DateTime) {
    return await applyTransition(memberId, activeBlockId, now, startBlockSnapshot);
}

export async function pauseBlock(memberId: bigint, activeBlockId: bigint, now: DateTime) {
    return await applyTransition(memberId, activeBlockId, now, pauseBlockSnapshot);
}

export async function resumeBlock(memberId: bigint, activeBlockId: bigint, now: DateTime) {
    return await applyTransition(memberId, activeBlockId, now, resumeBlockSnapshot);
}

/** 완료·삭제는 곧 정산이다. 되돌릴 수 없다 */
export async function completeBlock(
    memberId: bigint,
    activeBlockId: bigint,
    now: DateTime,
    trigger: SettlementTrigger,
): Promise<SettlementResult | null> {
    return await settleActiveBlock(memberId, activeBlockId, now, trigger);
}

/** 진행 중인 블록. 탭 전환·재진입·포커스 복귀 시 호출한다 (API명세 §2) */
/**
 * 블록 하나를 읽는다. 집중 화면(S-04)이 URL 의 id 로 부른다.
 *
 * ⚠️ `memberId` 조건을 반드시 건다. URL 의 id 를 신뢰하지 않는다 (아키텍처 §9).
 *    없으면 남의 블록 제목이 남의 화면에 뜬다.
 */
export async function findBlockOfMember(
    memberId: bigint,
    activeBlockId: bigint,
    now: DateTime,
): Promise<BlockView | null> {
    const row = await prisma.activeBlock.findFirst({
        where: { activeBlockId: activeBlockId, memberId: memberId },
    });

    if (row === null) {
        return null;
    }
    return toView(toSnapshot(row), now);
}

export async function findCurrentBlock(memberId: bigint, now: DateTime): Promise<BlockView | null> {
    const row = await prisma.activeBlock.findFirst({
        where: { memberId: memberId, blockStatus: { in: ['RUNNING', 'PAUSED'] } },
        orderBy: { plannedStartTime: 'asc' },
    });

    if (row === null) {
        return null;
    }
    return toView(toSnapshot(row), now);
}

/** 하루 화면이 쓰는 목록 */
export async function listBlocksOfDate(
    memberId: bigint,
    workDate: string,
    now: DateTime,
): Promise<BlockView[]> {
    const rows = await prisma.activeBlock.findMany({
        where: { memberId: memberId, workDate: dateStringToDateColumn(workDate) },
        orderBy: { plannedStartTime: 'asc' },
    });

    const views: BlockView[] = [];
    for (const row of rows) {
        views.push(toView(toSnapshot(row), now));
    }
    return views;
}

/** 예산 현황. 하루 화면의 미터가 쓴다 */
export async function loadDayBudget(memberId: bigint, workDate: string) {
    const occupants: BudgetOccupant[] = await loadDayOccupants(memberId, workDate);
    return calculateDailyBudget({ workDate: workDate, occupants: occupants });
}
