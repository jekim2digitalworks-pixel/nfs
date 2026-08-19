import 'server-only';
import type { BudgetOccupant } from '@nfs/domain';
import {
    dateStringToDateColumn,
    instantFromColumn,
    parseAppDate,
} from '@nfs/domain/time';
import { prisma } from '../prisma';

/**
 * 하루 예산의 점유자를 모은다 (정책 §2.2)
 *
 * 세 곳에서 온다:
 *   - 그날에 귀속된 `TimeLog` (이미 확정된 것)
 *   - 진행 중인 `ActiveBlock` (계획 시간 기준)
 *   - 제외되지 않은 `ImportedCalendarEvent`
 *
 * ⭐ 이 함수는 **등록 검증 · 하루 화면 · 이관 트랜잭션이 모두 같이 쓴다.**
 *    점유자 목록이 갈리면 "남은 시간"과 "겹침 차감"이 서로 다른 세계를 보게 된다.
 */

/** 자정을 넘는 일정까지 잡으려면 조회 구간을 하루씩 넓혀야 한다 */
function queryWindowOf(workDate: string): { from: Date; to: Date } {
    const dayStart = parseAppDate(workDate);

    return {
        from: dayStart.minus({ days: 1 }).toJSDate(),
        to: dayStart.plus({ days: 2 }).toJSDate(),
    };
}

export interface DayOccupantsOptions {
    /** 이관 중인 블록은 제외한다. 정산된 구간으로 따로 넣기 때문이다 */
    excludeActiveBlockId?: bigint;
}

export async function loadDayOccupants(
    memberId: bigint,
    workDate: string,
    options: DayOccupantsOptions = {},
): Promise<BudgetOccupant[]> {
    const window = queryWindowOf(workDate);
    const statDateColumn = dateStringToDateColumn(workDate);

    // 세 곳을 병렬로 읽는다. 순차면 DB 왕복이 세 번 쌓인다
    const [timeLogs, activeBlocks, calendarEvents] = await Promise.all([
        prisma.timeLog.findMany({
            where: { memberId: memberId, statDate: statDateColumn },
            select: {
                timeLogId: true,
                sourceType: true,
                categoryTag: true,
                title: true,
                startTime: true,
                endTime: true,
            },
        }),
        prisma.activeBlock.findMany({
            where: { memberId: memberId, workDate: statDateColumn },
            select: {
                activeBlockId: true,
                categoryTag: true,
                title: true,
                plannedStartTime: true,
                plannedMinutes: true,
            },
        }),
        prisma.importedCalendarEvent.findMany({
            where: {
                memberId: memberId,
                excludedFromStatistics: false,
                startTime: { lt: window.to },
                endTime: { gt: window.from },
            },
            select: {
                googleEventId: true,
                mappedCategoryTag: true,
                title: true,
                startTime: true,
                endTime: true,
            },
        }),
    ]);

    const occupants: BudgetOccupant[] = [];

    for (const log of timeLogs) {
        occupants.push({
            referenceKey: `timelog:${log.timeLogId.toString()}`,
            sourceType: log.sourceType,
            categoryTag: log.categoryTag,
            title: log.title,
            startTime: instantFromColumn(log.startTime),
            endTime: instantFromColumn(log.endTime),
        });
    }

    for (const block of activeBlocks) {
        if (options.excludeActiveBlockId === block.activeBlockId) {
            continue;
        }
        const plannedStart = instantFromColumn(block.plannedStartTime);

        occupants.push({
            referenceKey: `block:${block.activeBlockId.toString()}`,
            sourceType: 'NFS_BLOCK',
            categoryTag: block.categoryTag,
            title: block.title,
            startTime: plannedStart,
            // 계획 종료를 컬럼으로 두지 않는다 — 시작+길이로 파생한다 (데이터모델 §2.2)
            endTime: plannedStart.plus({ minutes: block.plannedMinutes }),
        });
    }

    for (const event of calendarEvents) {
        occupants.push({
            referenceKey: `calendar:${event.googleEventId}`,
            sourceType: 'GOOGLE_CALENDAR',
            categoryTag: event.mappedCategoryTag,
            title: event.title,
            startTime: instantFromColumn(event.startTime),
            endTime: instantFromColumn(event.endTime),
        });
    }

    return occupants;
}
