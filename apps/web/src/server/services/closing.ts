import 'server-only';
import type { DateTime } from 'luxon';
import type { CalendarSyncResult, GoogleScopeLevel } from '@nfs/db';
import {
    buildCalendarLedgerDraft,
    calculateDailyBudget,
    datesSpannedBy,
    isWeekClosable,
    isWorthRecording,
    openWeekStartDateOf,
    type BudgetOccupant,
    type CalendarEventSnapshot,
    type CalendarLedgerDraft,
} from '@nfs/domain';
import {
    dateColumnToDateString,
    dateStringToDateColumn,
    instantFromColumn,
    instantToColumn,
} from '@nfs/domain/time';
import { prisma } from '../prisma';
import { syncCalendarWeek } from './calendar-sync';
import { loadDayOccupants } from './day-occupants';

/**
 * 주간 마감 (B-09 · 정책 §3 · 데이터모델 §3.2) ⭐⭐
 *
 * 한 주가 끝나면 그 주의 캘린더 데이터를 원장으로 옮기고 **영구히 동결한다.**
 * 마감된 주는 구글을 다시 부르는 코드 경로가 존재하지 않는다.
 *
 * 자정 정산(B-08)과 뼈대는 같다 — 가변 작업 영역이 불변 원장으로 넘어간다.
 * 다른 점만 적는다:
 *
 *   | | 자정 정산 | 주간 마감 |
 *   |---|---|---|
 *   | 원본 | `ActiveBlock` (실측) | `ImportedCalendarEvent` (신고) |
 *   | 겹침 | 자기가 자리를 **먼저** 가져간다 | 블록에 자리를 **내준다** (정책 §2.1 규칙 4) |
 *   | 길이 | 최대 3시간 = 최대 2일 | 상한 없음 → 날짜별로 겹침을 재고 더한다 |
 *   | 되돌리기 | 없음 | 없음 (재개봉 없음 · 정책 §3.3) |
 *
 * ⭐ **최종 동기화(정책 §3.2 의 1단계)가 붙었다** (B-11). 마감 직전에 그 주를 한 번 더 읽어
 *    막판에 들어온 일정까지 원장에 담는다. 실패하면 마감을 멈추는 게 아니라
 *    `FAILED` 로 남기고 **이미 쌓여 있던 일정으로 마감한다** — 아래 `performFinalCalendarSync` 참조.
 */

export interface WeekClosingResult {
    weekStartDate: string;
    /** 원장에 새로 넣은 행 수 */
    importedEventCount: number;
    /** 겹침으로 0분이 됐거나 이미 원장에 있던 것 */
    skippedEventCount: number;
    calendarSyncResult: CalendarSyncResult;
    /** 이미 CLOSED 라 아무것도 하지 않았으면 false */
    closed: boolean;
}

interface ImportedEventRow {
    importedEventId: bigint;
    googleEventId: string;
    title: string;
    mappedCategoryTag: CalendarEventSnapshot['categoryTag'];
    startTime: Date;
    endTime: Date;
}

function toSnapshot(row: ImportedEventRow): CalendarEventSnapshot {
    return {
        googleEventId: row.googleEventId,
        title: row.title,
        categoryTag: row.mappedCategoryTag,
        startTime: instantFromColumn(row.startTime),
        endTime: instantFromColumn(row.endTime),
    };
}

interface FinalSyncOutcome {
    result: CalendarSyncResult;
    syncedTime: DateTime | null;
}

/**
 * 마감 직전 최종 1회 동기화 (B-11 · 정책 §3.2 1단계)
 *
 * 주중 내내 동기화가 돌고 있어도 **마감 직전에 한 번 더 읽는다.**
 * 일요일 오후에 추가한 일정은 그 뒤로 동기화가 한 번도 안 돌았을 수 있고,
 * 마감이 지나고 나면 그 주를 읽는 코드 경로가 영영 사라지기 때문이다.
 *
 * ⭐ **실패해도 마감을 멈추지 않는다.** 여기서 예외를 위로 던지면 `runWeeklyClosing` 이
 *    그 회원을 `failedMemberIds` 로 넘기고 그 주는 열린 채 남는다. 그러면 남은 일정이
 *    예산 계산기에 계속 점유자로 잡혀 **하루가 조용히 좁아진다.**
 *    구글이 죽은 것과 그 주를 못 닫는 것은 별개의 사고다 — 읽은 데까지로 닫고 사유를 남긴다.
 *
 * ⭐ **연동돼 있는데 최종 동기화를 못 했으면 `FAILED` 로 남긴다.**
 *    정책 §3.4 — *"조용히 0시간으로 처리하지 않는다."*
 *    `SYNCED` 로 적으면 리포트가 "이 주는 캘린더가 반영됐다"고 거짓말을 하고,
 *    사용자는 비어 있는 주를 보고 자기가 일을 안 했다고 착각한다.
 */
async function performFinalCalendarSync(
    memberId: bigint,
    weekStartDate: string,
    googleScopeLevel: GoogleScopeLevel,
    googleRefreshToken: string | null,
    now: DateTime,
): Promise<FinalSyncOutcome> {
    if (googleScopeLevel === 'NONE') {
        return { result: 'NOT_CONNECTED', syncedTime: null };
    }
    if (googleRefreshToken === null || googleRefreshToken.length === 0) {
        return { result: 'NOT_CONNECTED', syncedTime: null };
    }

    // syncCalendarWeek 은 토큰 만료·구글 장애를 status 로 돌려준다(throw 하지 않는다).
    // 그래도 감싸는 이유: fetch 가 아예 끊기거나 DB 가 튕기면 예외가 올라온다
    try {
        const syncView = await syncCalendarWeek(memberId, weekStartDate, now);

        if (syncView.status === 'SYNCED') {
            return { result: 'SYNCED', syncedTime: syncView.syncedTime };
        }
        if (syncView.status === 'NOT_CONNECTED') {
            return { result: 'NOT_CONNECTED', syncedTime: null };
        }
        return { result: 'FAILED', syncedTime: null };
    } catch (caught) {
        console.error(
            '[nfs] 마감 직전 최종 동기화 실패',
            memberId.toString(),
            weekStartDate,
            caught,
        );
        return { result: 'FAILED', syncedTime: null };
    }
}

/**
 * 일정 하나가 실제로 자기 몫으로 가져간 분을 구한다.
 *
 * ⭐ **예산 계산기를 그대로 쓴다.** 겹침 규칙을 여기서 다시 구현하면
 *    하루 화면의 "남은 시간"과 원장의 겹침 차감이 서로 다른 답을 낸다.
 *
 * 일정이 여러 날에 걸치면 **날짜마다 계산기를 돌리고 더한다.**
 * 계산기가 하루 단위인 건 한계가 아니라 정의다 — 1440분 상한이 날짜별 규칙이기 때문이다.
 */
async function measureEventMinutes(
    memberId: bigint,
    snapshot: CalendarEventSnapshot,
): Promise<{ grossMinutes: number; overlapDeductedMinutes: number }> {
    const dates = datesSpannedBy(snapshot.startTime, snapshot.endTime);

    let grossMinutes = 0;
    let overlapDeductedMinutes = 0;

    for (const workDate of dates) {
        const others = await loadDayOccupants(memberId, workDate, {
            excludeCalendarEventId: snapshot.googleEventId,
        });

        const selfOccupant: BudgetOccupant = {
            referenceKey: `closing:${snapshot.googleEventId}`,
            sourceType: 'GOOGLE_CALENDAR',
            categoryTag: snapshot.categoryTag,
            title: snapshot.title,
            startTime: snapshot.startTime,
            endTime: snapshot.endTime,
        };

        const budget = calculateDailyBudget({
            workDate: workDate,
            occupants: [...others, selfOccupant],
        });

        for (const attribution of budget.occupants) {
            if (attribution.referenceKey === selfOccupant.referenceKey) {
                grossMinutes = grossMinutes + attribution.grossMinutes;
                overlapDeductedMinutes =
                    overlapDeductedMinutes + attribution.overlapDeductedMinutes;
            }
        }
    }

    return {
        grossMinutes: grossMinutes,
        overlapDeductedMinutes: overlapDeductedMinutes,
    };
}

/**
 * 한 회원의 한 주를 마감한다.
 *
 * 순서 (데이터모델 §3.2)
 *   1. 최종 동기화 (B-11 · 실패해도 이미 쌓인 일정으로 계속 간다)
 *   2. 제외되지 않은 일정만 대상
 *   3. 일정별 겹침 차감 → 0분이면 스킵
 *   4. TimeLog INSERT
 *   5. 그 주 ImportedCalendarEvent DELETE
 *   6. weekly_closing = CLOSED
 *
 * ⭐ 4·5·6 이 한 트랜잭션이고, **읽기와 계산은 그 밖에 있다.**
 *    계산까지 트랜잭션 안에 넣으면 일정 수에 비례해 트랜잭션이 길어져
 *    Prisma 의 5초 상한에 걸리고, 그동안 행을 붙잡고 있게 된다.
 */
export async function closeWeek(
    memberId: bigint,
    weekStartDate: string,
    now: DateTime,
): Promise<WeekClosingResult> {
    if (!isWeekClosable(weekStartDate, now)) {
        // 호출부가 이미 걸렀어야 한다. 여기까지 왔으면 대상 선정이 틀린 것이다.
        // 마감은 되돌릴 수 없으므로 조용히 넘어가지 않고 터뜨린다.
        throw new Error(`아직 마감할 수 없는 주입니다: ${weekStartDate}`);
    }

    const weekColumn = dateStringToDateColumn(weekStartDate);

    const existingClosing = await prisma.weeklyClosing.findUnique({
        where: {
            memberId_weekStartDate: { memberId: memberId, weekStartDate: weekColumn },
        },
    });

    if (existingClosing !== null && existingClosing.closingStatus === 'CLOSED') {
        // 멱등성. 배치가 두 번 돌아도 마감된 주를 다시 열지 않는다.
        //
        // ⚠️ 다만 **동결된 주에 일정이 남아 있으면 지운다.**
        //    마감이 끝나면 그 주의 일정은 원장에 들어갈 길이 영영 없는데,
        //    남겨두면 예산 계산기가 계속 점유자로 세서 하루가 조용히 좁아진다.
        //    여기 걸린다는 건 동기화(B-11)가 마감된 주를 다시 썼다는 뜻이므로 로그를 남긴다.
        const strayEvents = await prisma.importedCalendarEvent.deleteMany({
            where: { memberId: memberId, weekStartDate: weekColumn },
        });

        if (strayEvents.count > 0) {
            console.warn(
                '[nfs] 마감된 주에 남아 있던 일정을 정리했습니다',
                memberId.toString(),
                weekStartDate,
                strayEvents.count,
            );
        }

        return {
            weekStartDate: weekStartDate,
            importedEventCount: 0,
            skippedEventCount: strayEvents.count,
            calendarSyncResult: existingClosing.calendarSyncResult,
            closed: false,
        };
    }

    const member = await prisma.member.findUnique({
        where: { memberId: memberId },
        select: { googleScopeLevel: true, googleRefreshToken: true },
    });

    if (member === null) {
        throw new Error(`회원을 찾을 수 없습니다: ${memberId.toString()}`);
    }

    const syncOutcome = await performFinalCalendarSync(
        memberId,
        weekStartDate,
        member.googleScopeLevel,
        member.googleRefreshToken,
        now,
    );

    const events = await prisma.importedCalendarEvent.findMany({
        where: {
            memberId: memberId,
            weekStartDate: weekColumn,
            // 필터 7종에 걸렸거나 사용자가 끈 일정은 통계에 넣지 않는다 (정책 §4.2)
            excludedFromStatistics: false,
        },
        select: {
            importedEventId: true,
            googleEventId: true,
            title: true,
            mappedCategoryTag: true,
            startTime: true,
            endTime: true,
        },
    });

    const drafts: CalendarLedgerDraft[] = [];
    let skippedEventCount = 0;

    for (const row of events) {
        const snapshot = toSnapshot(row);
        const measured = await measureEventMinutes(memberId, snapshot);
        const draft = buildCalendarLedgerDraft(
            snapshot,
            measured.grossMinutes,
            measured.overlapDeductedMinutes,
        );

        if (!isWorthRecording(draft)) {
            skippedEventCount = skippedEventCount + 1;
            continue;
        }
        drafts.push(draft);
    }

    const insertedCount = await prisma.$transaction(async function freezeWeek(tx) {
        let inserted = 0;

        if (drafts.length > 0) {
            const rows = [];
            for (const draft of drafts) {
                rows.push({
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
                    overlapDeductedMinutes: draft.overlapDeductedMinutes,
                    completionType: draft.completionType,
                    pauseCount: draft.pauseCount,
                });
            }

            // 백필(B-13)이 같은 이벤트를 이미 넣어뒀을 수 있다.
            // UNIQUE 위반을 예외로 받으면 트랜잭션이 통째로 죽어 마감 자체가 막힌다
            const insertResult = await tx.timeLog.createMany({
                data: rows,
                skipDuplicates: true,
            });
            inserted = insertResult.count;
        }

        // 제외된 일정까지 전부 지운다. 주가 동결되면 다시 볼 일이 없고,
        // 남겨두면 예산 계산기가 마감된 주를 계속 점유자로 센다
        await tx.importedCalendarEvent.deleteMany({
            where: { memberId: memberId, weekStartDate: weekColumn },
        });

        await tx.weeklyClosing.upsert({
            where: {
                memberId_weekStartDate: { memberId: memberId, weekStartDate: weekColumn },
            },
            create: {
                memberId: memberId,
                weekStartDate: weekColumn,
                closingStatus: 'CLOSED',
                closedTime: instantToColumn(now),
                calendarSyncResult: syncOutcome.result,
                lastSyncedTime:
                    syncOutcome.syncedTime === null
                        ? null
                        : instantToColumn(syncOutcome.syncedTime),
                importedEventCount: inserted,
            },
            update: {
                closingStatus: 'CLOSED',
                closedTime: instantToColumn(now),
                calendarSyncResult: syncOutcome.result,
                importedEventCount: inserted,
            },
        });

        return inserted;
    });

    return {
        weekStartDate: weekStartDate,
        importedEventCount: insertedCount,
        skippedEventCount: skippedEventCount,
        calendarSyncResult: syncOutcome.result,
        closed: true,
    };
}

/**
 * 주간 마감 배치 (B-09 · API명세 §6)
 *
 * 대상은 **"지난주 하나"가 아니라 마감 기한을 넘긴 모든 주**다.
 * 자정 정산과 같은 원칙이다 (N-031) — 배치가 한 주 걸러도 다음 실행이 따라잡는다.
 *
 * 두 곳에서 대상을 모은다:
 *   1. `weekly_closing` 이 `OPEN` 인 주   — 동기화가 만들어둔 정상 경로
 *   2. 마감 행 없이 일정만 쌓여 있는 주   — 동기화 도중 끊겼거나 백필이 남긴 것
 *
 * 2번이 없으면 그 일정들은 영원히 원장에 못 들어가고 예산만 갉아먹는다.
 */
export interface WeeklyClosingSummary {
    processedMemberCount: number;
    closedWeekCount: number;
    importedEventCount: number;
    skippedEventCount: number;
    failedMemberIds: string[];
    hasMore: boolean;
}

/** 한 번의 호출에서 마감할 (회원 × 주) 쌍의 최대 개수 */
const CLOSING_TARGET_LIMIT = 100;

interface ClosingTarget {
    memberId: bigint;
    weekStartDate: string;
}

async function loadClosingTargets(openWeekStartDate: string): Promise<ClosingTarget[]> {
    const openWeekColumn = dateStringToDateColumn(openWeekStartDate);
    const fetchLimit = CLOSING_TARGET_LIMIT + 1;

    const [openClosings, orphanEventWeeks] = await Promise.all([
        prisma.weeklyClosing.findMany({
            where: { closingStatus: 'OPEN', weekStartDate: { lt: openWeekColumn } },
            select: { memberId: true, weekStartDate: true },
            orderBy: [{ weekStartDate: 'asc' }, { memberId: 'asc' }],
            take: fetchLimit,
        }),
        prisma.importedCalendarEvent.groupBy({
            by: ['memberId', 'weekStartDate'],
            where: { weekStartDate: { lt: openWeekColumn } },
            orderBy: [{ weekStartDate: 'asc' }, { memberId: 'asc' }],
            take: fetchLimit,
        }),
    ]);

    // 같은 주가 양쪽에 다 나올 수 있다. 키로 합친다
    const uniqueTargets = new Map<string, ClosingTarget>();

    for (const row of [...openClosings, ...orphanEventWeeks]) {
        const weekStartDate = dateColumnToDateString(row.weekStartDate);
        const key = `${row.memberId.toString()}:${weekStartDate}`;

        if (!uniqueTargets.has(key)) {
            uniqueTargets.set(key, {
                memberId: row.memberId,
                weekStartDate: weekStartDate,
            });
        }
    }

    const targets = Array.from(uniqueTargets.values());

    // 오래된 주부터 닫는다. 순서가 흔들리면 hasMore 재호출이 같은 대상을 맴돈다
    targets.sort(function byWeekThenMember(left, right) {
        if (left.weekStartDate !== right.weekStartDate) {
            return left.weekStartDate < right.weekStartDate ? -1 : 1;
        }
        if (left.memberId === right.memberId) {
            return 0;
        }
        return left.memberId < right.memberId ? -1 : 1;
    });

    return targets;
}

export async function runWeeklyClosing(now: DateTime): Promise<WeeklyClosingSummary> {
    const openWeekStartDate = openWeekStartDateOf(now);
    const allTargets = await loadClosingTargets(openWeekStartDate);

    // 마감 기한(월 04:00)을 아직 안 넘긴 주는 뺀다.
    // 자정 정산이 도는 월요일 00:05 에는 지난주가 여기서 걸러진다 — 그게 맞다
    const closableTargets: ClosingTarget[] = [];
    for (const target of allTargets) {
        if (isWeekClosable(target.weekStartDate, now)) {
            closableTargets.push(target);
        }
    }

    let hasMore = false;
    let processableTargets = closableTargets;

    if (closableTargets.length > CLOSING_TARGET_LIMIT) {
        hasMore = true;
        processableTargets = closableTargets.slice(0, CLOSING_TARGET_LIMIT);
    }

    const processedMemberIds = new Set<string>();
    const failedMemberIds: string[] = [];
    let closedWeekCount = 0;
    let importedEventCount = 0;
    let skippedEventCount = 0;

    for (const target of processableTargets) {
        const memberIdText = target.memberId.toString();
        processedMemberIds.add(memberIdText);

        try {
            const result = await closeWeek(target.memberId, target.weekStartDate, now);

            if (result.closed) {
                closedWeekCount = closedWeekCount + 1;
            }
            importedEventCount = importedEventCount + result.importedEventCount;
            skippedEventCount = skippedEventCount + result.skippedEventCount;
        } catch (caught) {
            // 한 명의 구글 장애·커넥션 오류가 전체 마감을 멈추면 안 된다 (API명세 §6)
            console.error(
                '[nfs] weekly closing failed',
                memberIdText,
                target.weekStartDate,
                caught,
            );
            failedMemberIds.push(memberIdText);
        }
    }

    return {
        processedMemberCount: processedMemberIds.size,
        closedWeekCount: closedWeekCount,
        importedEventCount: importedEventCount,
        skippedEventCount: skippedEventCount,
        failedMemberIds: failedMemberIds,
        hasMore: hasMore,
    };
}
