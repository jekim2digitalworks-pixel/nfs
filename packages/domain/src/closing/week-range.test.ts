import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    closingDeadlineOf,
    isWeekClosable,
    openWeekStartDateOf,
    weekRangeOf,
} from './week-range';
import { APP_ZONE } from '../time/zone';

/** KST 로 읽는 시각 */
function kst(isoString: string): DateTime {
    return DateTime.fromISO(isoString, { zone: APP_ZONE });
}

/** 실행 환경(UTC)에서 들어오는 시각. 배치는 항상 이 모양으로 now 를 받는다 */
function utc(isoString: string): DateTime {
    return DateTime.fromISO(isoString, { zone: 'utc' });
}

describe('주 구간 (정책 §3.3)', () => {
    it('월요일 00:00 부터 다음 월요일 00:00 직전까지다', () => {
        const range = weekRangeOf('2026-08-17'); // 월요일

        expect(range.startInstant.toISO()).toBe(kst('2026-08-17T00:00:00').toISO());
        expect(range.endInstant.toISO()).toBe(kst('2026-08-24T00:00:00').toISO());
    });

    it('연말 경계에서도 그냥 7일이다 — ISO 주차의 함정이 없다', () => {
        const range = weekRangeOf('2026-12-28');

        expect(range.endInstant.toFormat('yyyy-MM-dd')).toBe('2027-01-04');
    });
});

describe('마감 기한 — 다음 주 월요일 04:00 (정책 §3.3)', () => {
    it('주가 끝나고 4시간 뒤다', () => {
        const deadline = closingDeadlineOf('2026-08-17');

        expect(deadline.toISO()).toBe(kst('2026-08-24T04:00:00').toISO());
    });

    it('03:59 에는 아직 못 닫는다 — 일요일 밤에 정리하는 사람의 유예 시간이다', () => {
        expect(isWeekClosable('2026-08-17', kst('2026-08-24T03:59:59'))).toBe(false);
    });

    it('04:00 정각부터 닫을 수 있다', () => {
        expect(isWeekClosable('2026-08-17', kst('2026-08-24T04:00:00'))).toBe(true);
    });

    it('⭐ UTC 로 들어온 now 로도 같은 답이 나온다 — 배치는 UTC 로 돈다', () => {
        // KST 월 04:00 = UTC 일 19:00. 존을 안 옮기면 여기서 하루가 어긋난다
        expect(isWeekClosable('2026-08-17', utc('2026-08-23T18:59:59Z'))).toBe(false);
        expect(isWeekClosable('2026-08-17', utc('2026-08-23T19:00:00Z'))).toBe(true);
    });

    it('배치가 밀려 목요일에 돌아도 지난주는 여전히 닫힌다', () => {
        expect(isWeekClosable('2026-08-17', kst('2026-08-27T11:00:00'))).toBe(true);
    });

    it('이번 주는 아직 못 닫는다', () => {
        expect(isWeekClosable('2026-08-24', kst('2026-08-27T11:00:00'))).toBe(false);
    });
});

describe('열린 주의 기준선', () => {
    it('지금이 속한 주의 월요일이다 — 이보다 앞선 주만 마감 대상이다', () => {
        expect(openWeekStartDateOf(kst('2026-08-20T09:00:00'))).toBe('2026-08-17');
    });

    it('⭐ UTC 일요일 19:00 은 KST 로 이미 월요일이다 — 새 주가 열려 있어야 한다', () => {
        expect(openWeekStartDateOf(utc('2026-08-23T19:00:00Z'))).toBe('2026-08-24');
    });

    it('일요일 23:59(KST)에는 아직 그 주가 열려 있다', () => {
        expect(openWeekStartDateOf(kst('2026-08-23T23:59:00'))).toBe('2026-08-17');
    });
});
