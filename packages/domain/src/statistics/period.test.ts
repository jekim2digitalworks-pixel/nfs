import { describe, expect, it } from 'vitest';
import {
    comparisonLabelOf,
    monthsOfYear,
    periodRangeOf,
    previousPeriodRangeOf,
    sharePercentOf,
} from './period';

describe('periodRangeOf — 기간 범위', () => {
    it('DAY 는 그 하루다', () => {
        const range = periodRangeOf('DAY', '2026-08-19');

        expect(range.fromDate).toBe('2026-08-19');
        expect(range.toDate).toBe('2026-08-19');
        expect(range.label).toBe('8월 19일');
    });

    it('WEEK 은 월요일~일요일이다 (마감 단위와 같다)', () => {
        // 2026-08-19 는 수요일
        const range = periodRangeOf('WEEK', '2026-08-19');

        expect(range.fromDate).toBe('2026-08-17'); // 월
        expect(range.toDate).toBe('2026-08-23'); // 일
    });

    it('WEEK — 일요일은 그 주의 마지막 날이다 (다음 주로 밀리지 않는다)', () => {
        const range = periodRangeOf('WEEK', '2026-08-23');

        expect(range.fromDate).toBe('2026-08-17');
        expect(range.toDate).toBe('2026-08-23');
    });

    it('MONTH 는 1일~말일이다', () => {
        const range = periodRangeOf('MONTH', '2026-08-19');

        expect(range.fromDate).toBe('2026-08-01');
        expect(range.toDate).toBe('2026-08-31');
        expect(range.label).toBe('2026년 8월');
    });

    it('MONTH — 30일 달과 2월 말일을 정확히 잡는다', () => {
        expect(periodRangeOf('MONTH', '2026-04-15').toDate).toBe('2026-04-30');
        expect(periodRangeOf('MONTH', '2026-02-10').toDate).toBe('2026-02-28');
        // 2028 은 윤년이다
        expect(periodRangeOf('MONTH', '2028-02-10').toDate).toBe('2028-02-29');
    });

    it('YEAR 는 1월 1일~12월 31일이다', () => {
        const range = periodRangeOf('YEAR', '2026-08-19');

        expect(range.fromDate).toBe('2026-01-01');
        expect(range.toDate).toBe('2026-12-31');
        expect(range.label).toBe('2026년');
    });
});

describe('previousPeriodRangeOf — 직전 기간', () => {
    it('DAY 의 직전은 어제다', () => {
        const previous = previousPeriodRangeOf(periodRangeOf('DAY', '2026-08-01'));

        expect(previous.fromDate).toBe('2026-07-31');
    });

    it('WEEK 의 직전은 지난주 월~일이다', () => {
        const previous = previousPeriodRangeOf(periodRangeOf('WEEK', '2026-08-19'));

        expect(previous.fromDate).toBe('2026-08-10');
        expect(previous.toDate).toBe('2026-08-16');
    });

    it('⭐ MONTH 는 30일을 빼지 않고 달력 단위로 물러난다', () => {
        // 3월 31일 기준. 30일을 빼는 방식이면 3월 1일이 되어 같은 달을 가리킨다.
        const previous = previousPeriodRangeOf(periodRangeOf('MONTH', '2026-03-31'));

        expect(previous.fromDate).toBe('2026-02-01');
        expect(previous.toDate).toBe('2026-02-28');
    });

    it('1월의 직전은 작년 12월이다 (연도 경계)', () => {
        const previous = previousPeriodRangeOf(periodRangeOf('MONTH', '2026-01-15'));

        expect(previous.fromDate).toBe('2025-12-01');
        expect(previous.toDate).toBe('2025-12-31');
    });

    it('연초 주간의 직전은 작년 마지막 주다', () => {
        // 2026-01-01 은 목요일 → 그 주 월요일은 2025-12-29
        const thisWeek = periodRangeOf('WEEK', '2026-01-01');
        expect(thisWeek.fromDate).toBe('2025-12-29');

        const previous = previousPeriodRangeOf(thisWeek);
        expect(previous.fromDate).toBe('2025-12-22');
    });

    it('YEAR 의 직전은 작년이다', () => {
        const previous = previousPeriodRangeOf(periodRangeOf('YEAR', '2026-08-19'));

        expect(previous.fromDate).toBe('2025-01-01');
        expect(previous.toDate).toBe('2025-12-31');
    });
});

describe('sharePercentOf — 비율', () => {
    it('소수 첫째 자리까지 반올림한다', () => {
        expect(sharePercentOf(3130, 11250)).toBe(27.8);
        expect(sharePercentOf(1, 3)).toBe(33.3);
    });

    it('⭐ 분모가 0이면 NaN 이 아니라 0이다', () => {
        // NaN 이 화면까지 흘러가면 "NaN%" 가 그대로 찍힌다
        expect(sharePercentOf(0, 0)).toBe(0);
        expect(sharePercentOf(100, 0)).toBe(0);
        expect(sharePercentOf(0, 0)).not.toBeNaN();
    });

    it('전부 차지하면 100 이다', () => {
        expect(sharePercentOf(500, 500)).toBe(100);
    });
});

describe('monthsOfYear — 월별 추이', () => {
    it('12개 구간을 순서대로 준다', () => {
        const months = monthsOfYear(2026);

        expect(months).toHaveLength(12);
        expect(months[0]?.fromDate).toBe('2026-01-01');
        expect(months[11]?.toDate).toBe('2026-12-31');
    });
});

describe('comparisonLabelOf', () => {
    it('기간별 한국어 라벨을 준다', () => {
        expect(comparisonLabelOf('DAY')).toBe('어제보다');
        expect(comparisonLabelOf('WEEK')).toBe('지난주보다');
        expect(comparisonLabelOf('MONTH')).toBe('지난달보다');
        expect(comparisonLabelOf('YEAR')).toBe('작년보다');
    });
});
