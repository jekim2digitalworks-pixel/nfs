import { z } from 'zod';
import { APP_ZONE, parseAppDate, weekStartDateOf } from '../time/zone';

/**
 * 통계 기간 (API명세 §4)
 *
 * 리포트 화면의 축이다. 기간을 잘못 잡으면 숫자가 통째로 틀리는데,
 * 월말·연말 경계에서 조용히 틀려서 눈에 잘 안 띈다. 그래서 순수 함수로 빼고 테스트로 고정한다.
 */

export const STATISTICS_PERIODS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export const StatisticsPeriodSchema = z.enum(STATISTICS_PERIODS);
export type StatisticsPeriod = z.infer<typeof StatisticsPeriodSchema>;

/** 통계 조회 구간. 양 끝 **모두 포함**한다 (`stat_date BETWEEN from AND to`) */
export interface PeriodRange {
    period: StatisticsPeriod;
    /** 'yyyy-MM-dd' */
    fromDate: string;
    /** 'yyyy-MM-dd' */
    toDate: string;
    /** 화면 상단에 그대로 쓰는 한국어 라벨 */
    label: string;
}

/**
 * 기준 날짜가 속한 기간의 범위를 구한다.
 *
 * ⚠️ `stat_date` 는 DATE 컬럼이므로 구간을 **날짜 문자열**로 다룬다.
 *    시각으로 다루면 경계에서 하루가 새거나 빠진다.
 */
export function periodRangeOf(period: StatisticsPeriod, anchorDate: string): PeriodRange {
    const anchor = parseAppDate(anchorDate);

    if (period === 'DAY') {
        return {
            period: period,
            fromDate: anchorDate,
            toDate: anchorDate,
            label: anchor.toFormat('M월 d일'),
        };
    }

    if (period === 'WEEK') {
        // 주의 시작은 월요일이다 (정책 §3). 여기서도 같은 규칙을 쓴다 —
        // 마감 단위와 통계 단위가 어긋나면 "마감된 주"와 "이번 주 리포트"가 다른 구간을 가리킨다.
        const monday = parseAppDate(weekStartDateOf(anchor));
        const sunday = monday.plus({ days: 6 });

        return {
            period: period,
            fromDate: monday.toFormat('yyyy-MM-dd'),
            toDate: sunday.toFormat('yyyy-MM-dd'),
            label: `${monday.toFormat('M월 d일')} – ${sunday.toFormat('M월 d일')}`,
        };
    }

    if (period === 'MONTH') {
        const first = anchor.startOf('month');
        const last = anchor.endOf('month').startOf('day');

        return {
            period: period,
            fromDate: first.toFormat('yyyy-MM-dd'),
            toDate: last.toFormat('yyyy-MM-dd'),
            label: anchor.toFormat('yyyy년 M월'),
        };
    }

    const firstOfYear = anchor.startOf('year');
    const lastOfYear = anchor.endOf('year').startOf('day');

    return {
        period: period,
        fromDate: firstOfYear.toFormat('yyyy-MM-dd'),
        toDate: lastOfYear.toFormat('yyyy-MM-dd'),
        label: anchor.toFormat('yyyy년'),
    };
}

/**
 * 직전 기간. 「지난달보다 17시간 20분」 같은 비교에 쓴다.
 *
 * **길이를 빼는 게 아니라 달력 단위로 물러난다.**
 * 30일을 빼는 방식이면 2월과 3월이 어긋나고, 윤년에 하루가 샌다.
 */
export function previousPeriodRangeOf(range: PeriodRange): PeriodRange {
    const anchor = parseAppDate(range.fromDate);

    if (range.period === 'DAY') {
        return periodRangeOf('DAY', anchor.minus({ days: 1 }).toFormat('yyyy-MM-dd'));
    }
    if (range.period === 'WEEK') {
        return periodRangeOf('WEEK', anchor.minus({ weeks: 1 }).toFormat('yyyy-MM-dd'));
    }
    if (range.period === 'MONTH') {
        return periodRangeOf('MONTH', anchor.minus({ months: 1 }).toFormat('yyyy-MM-dd'));
    }
    return periodRangeOf('YEAR', anchor.minus({ years: 1 }).toFormat('yyyy-MM-dd'));
}

/** 직전 기간 대비 라벨. 화면이 그대로 쓴다 */
export function comparisonLabelOf(period: StatisticsPeriod): string {
    if (period === 'DAY') {
        return '어제보다';
    }
    if (period === 'WEEK') {
        return '지난주보다';
    }
    if (period === 'MONTH') {
        return '지난달보다';
    }
    return '작년보다';
}

/**
 * 전체에서 차지하는 비율(%). 소수 첫째 자리까지.
 *
 * 분모가 0이면 0을 돌려준다 — NaN 이 화면까지 흘러가면 "NaN%" 가 그대로 찍힌다.
 */
export function sharePercentOf(partMinutes: number, totalMinutes: number): number {
    if (totalMinutes <= 0) {
        return 0;
    }
    return Math.round((partMinutes / totalMinutes) * 1000) / 10;
}

/** 연도의 12개월 구간. 월별 추이 차트가 쓴다 */
export function monthsOfYear(year: number): PeriodRange[] {
    const ranges: PeriodRange[] = [];

    for (let month = 1; month <= 12; month = month + 1) {
        const monthText = String(month).padStart(2, '0');
        ranges.push(periodRangeOf('MONTH', `${year}-${monthText}-01`));
    }
    return ranges;
}

/** 타임존을 아는 곳은 하나여야 하므로, 라벨 포맷도 여기서만 만든다 */
export const STATISTICS_ZONE = APP_ZONE;
