import 'server-only';
import {
    comparisonLabelOf,
    previousPeriodRangeOf,
    sharePercentOf,
    type CategoryTag,
    type PeriodRange,
    type StatisticsPeriod,
} from '@nfs/domain';
import { dateStringToDateColumn } from '@nfs/domain/time';
import { periodRangeOf } from '@nfs/domain';
import { prisma } from '../prisma';

/**
 * 통계 집계 (B-07 · API명세 §4)
 *
 * ⭐ **집중 시간과 일정 시간을 절대 더하지 않는다.** (기획 §2.2)
 *    분을 담는 컬럼은 `actualFocusMinutes` 하나뿐이고, 같은 컬럼이 출처에 따라 다른 것을 뜻한다:
 *      NFS_BLOCK       → 타이머가 증명한 시간 (실측)
 *      GOOGLE_CALENDAR → 일정표가 주장하는 시간 (신고)
 *    이 격차 자체가 제품의 인사이트다 —
 *    "캘린더에선 회의가 1등인데, 실제로 집중한 건 개발이었다."
 *
 * 집계는 DB 에서 한다. 월 단위는 수천 행이고 화면이 필요한 건 합계뿐이다.
 */

export interface PeriodTotals {
    /** 실측 — NFS 블록 */
    focusMinutes: number;
    /** 신고 — 구글 캘린더 */
    calendarMinutes: number;
}

export interface TagStatistics extends PeriodTotals {
    categoryTag: CategoryTag;
    /** 두 값의 단순 합. **화면에서 "총 시간"으로 쓰지 않는다** — 정렬과 비율 계산용이다 */
    combinedMinutes: number;
    /** 전체 대비 비율(%) */
    sharePercent: number;
}

export interface StatisticsSummary {
    range: PeriodRange;
    totals: PeriodTotals;
    previous: PeriodTotals;
    /** 직전 기간 대비 집중 시간 증감 */
    focusDeltaMinutes: number;
    comparisonLabel: string;
}

export interface TagBreakdown {
    range: PeriodRange;
    totals: PeriodTotals;
    tags: TagStatistics[];
}

interface RawTotalsRow {
    sourceType: string;
    categoryTag: CategoryTag;
    minutes: number;
}

/**
 * 기간 안의 원장을 출처·태그별로 묶는다.
 *
 * Prisma `groupBy` 로 충분한 자리다. 조건부 합계가 필요한 월별 추이만 raw 로 간다 (§4.1).
 */
async function loadRawTotals(memberId: bigint, range: PeriodRange): Promise<RawTotalsRow[]> {
    const rows = await prisma.timeLog.groupBy({
        by: ['sourceType', 'categoryTag'],
        where: {
            memberId: memberId,
            statDate: {
                gte: dateStringToDateColumn(range.fromDate),
                lte: dateStringToDateColumn(range.toDate),
            },
        },
        _sum: { actualFocusMinutes: true },
    });

    const converted: RawTotalsRow[] = [];
    for (const row of rows) {
        converted.push({
            sourceType: row.sourceType,
            categoryTag: row.categoryTag,
            // _sum 은 행이 없으면 null 이다. 0 으로 접는다
            minutes: row._sum.actualFocusMinutes ?? 0,
        });
    }
    return converted;
}

function totalsOf(rows: readonly RawTotalsRow[]): PeriodTotals {
    let focusMinutes = 0;
    let calendarMinutes = 0;

    for (const row of rows) {
        if (row.sourceType === 'NFS_BLOCK') {
            focusMinutes = focusMinutes + row.minutes;
        } else {
            calendarMinutes = calendarMinutes + row.minutes;
        }
    }
    return { focusMinutes: focusMinutes, calendarMinutes: calendarMinutes };
}

/** 히어로 총계 + 직전 기간 대비 (API명세 §4 summary) */
export async function loadStatisticsSummary(
    memberId: bigint,
    period: StatisticsPeriod,
    anchorDate: string,
): Promise<StatisticsSummary> {
    const range = periodRangeOf(period, anchorDate);
    const previousRange = previousPeriodRangeOf(range);

    // 두 기간을 병렬로 읽는다. 순차로 하면 왕복이 두 번이고,
    // 서버리스에서 DB 왕복 지연이 응답 시간의 대부분이다.
    const [currentRows, previousRows] = await Promise.all([
        loadRawTotals(memberId, range),
        loadRawTotals(memberId, previousRange),
    ]);

    const totals = totalsOf(currentRows);
    const previous = totalsOf(previousRows);

    return {
        range: range,
        totals: totals,
        previous: previous,
        // 증감은 **집중 시간만** 본다. 일정 시간은 내가 통제한 값이 아니라 비교의 의미가 약하다
        focusDeltaMinutes: totals.focusMinutes - previous.focusMinutes,
        comparisonLabel: comparisonLabelOf(period),
    };
}

/** 링 차트 + 목록 (API명세 §4 by-tag) */
export async function loadTagBreakdown(
    memberId: bigint,
    period: StatisticsPeriod,
    anchorDate: string,
): Promise<TagBreakdown> {
    const range = periodRangeOf(period, anchorDate);
    const rows = await loadRawTotals(memberId, range);
    const totals = totalsOf(rows);

    // 태그별로 접는다. 같은 태그가 출처별로 두 행이 될 수 있다
    const byTag = new Map<CategoryTag, PeriodTotals>();
    for (const row of rows) {
        const current = byTag.get(row.categoryTag) ?? { focusMinutes: 0, calendarMinutes: 0 };

        if (row.sourceType === 'NFS_BLOCK') {
            current.focusMinutes = current.focusMinutes + row.minutes;
        } else {
            current.calendarMinutes = current.calendarMinutes + row.minutes;
        }
        byTag.set(row.categoryTag, current);
    }

    const combinedTotal = totals.focusMinutes + totals.calendarMinutes;

    const tags: TagStatistics[] = [];
    for (const [categoryTag, tagTotals] of byTag) {
        const combinedMinutes = tagTotals.focusMinutes + tagTotals.calendarMinutes;

        tags.push({
            categoryTag: categoryTag,
            focusMinutes: tagTotals.focusMinutes,
            calendarMinutes: tagTotals.calendarMinutes,
            combinedMinutes: combinedMinutes,
            sharePercent: sharePercentOf(combinedMinutes, combinedTotal),
        });
    }

    // 많이 쓴 순. 링 차트와 목록이 이 순서를 그대로 쓴다
    tags.sort(function compareByMinutesDescending(left, right) {
        if (left.combinedMinutes !== right.combinedMinutes) {
            return right.combinedMinutes - left.combinedMinutes;
        }
        return left.categoryTag.localeCompare(right.categoryTag);
    });

    return { range: range, totals: totals, tags: tags };
}

export interface MonthlyPoint {
    /** 'yyyy-MM' */
    yearMonth: string;
    focusMinutes: number;
    calendarMinutes: number;
}

interface MonthlyRawRow {
    yearMonth: string;
    focusMinutes: bigint;
    calendarMinutes: bigint;
}

/**
 * 12개월 추이 (API명세 §4 monthly)
 *
 * ⚠️ **여기만 `$queryRaw` 를 쓴다.** 월별 버킷팅과 조건부 합계는
 *    Prisma `groupBy` 로 표현할 수 없고, 억지로 맞추면 앱에서 12번 쿼리하게 된다.
 *
 * Postgres 방언 주의 (아키텍처 §4.1):
 *   - `to_char(…, 'YYYY-MM')` — MySQL 의 `DATE_FORMAT` 이 아니다
 *   - 별칭에 **큰따옴표 필수** — 없으면 소문자로 접혀 `yearmonth` 가 된다
 *   - `SUM(int)` 이 **bigint** 로 온다 → `Number()` 변환 없으면 JSON 직렬화에서 터진다
 */
export async function loadMonthlyTrend(memberId: bigint, year: number): Promise<MonthlyPoint[]> {
    const fromDate = dateStringToDateColumn(`${year}-01-01`);
    const toDate = dateStringToDateColumn(`${year}-12-31`);

    const rows = await prisma.$queryRaw<MonthlyRawRow[]>`
        SELECT to_char(stat_date, 'YYYY-MM') AS "yearMonth",
               SUM(CASE WHEN source_type = 'NFS_BLOCK'       THEN actual_focus_minutes ELSE 0 END) AS "focusMinutes",
               SUM(CASE WHEN source_type = 'GOOGLE_CALENDAR' THEN actual_focus_minutes ELSE 0 END) AS "calendarMinutes"
          FROM time_log
         WHERE member_id = ${memberId}
           AND stat_date BETWEEN ${fromDate} AND ${toDate}
         GROUP BY 1
         ORDER BY 1`;

    // 데이터가 없는 달도 0으로 채운다. 화면이 빈 칸을 만들지 않게 —
    // 차트가 12칸을 전제하는데 8칸만 오면 축이 어긋난다.
    const byMonth = new Map<string, MonthlyRawRow>();
    for (const row of rows) {
        byMonth.set(row.yearMonth, row);
    }

    const points: MonthlyPoint[] = [];
    for (let month = 1; month <= 12; month = month + 1) {
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        const found = byMonth.get(yearMonth);

        points.push({
            yearMonth: yearMonth,
            focusMinutes: found === undefined ? 0 : Number(found.focusMinutes),
            calendarMinutes: found === undefined ? 0 : Number(found.calendarMinutes),
        });
    }
    return points;
}
