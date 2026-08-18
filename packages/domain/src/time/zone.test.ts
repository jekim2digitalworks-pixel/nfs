import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    APP_ZONE,
    minutesFromStartOfDay,
    minutesUntilMidnight,
    parseAppDate,
    parseAppDateTime,
    toAppLocalString,
    weekStartDateOf,
    workDateOf,
} from './zone';

/**
 * 이 스위트는 프로세스 타임존이 무엇이든 통과해야 한다.
 *
 * vitest.config.ts 가 TZ=UTC 로 고정하는 이유는 그게 운영 환경(Vercel · GitHub Actions)이기 때문이다.
 * 예전 EC2 전제에서는 "UTC 로 띄우면 실패해야 한다"가 목표였지만,
 * 서버리스로 옮기면서 기대가 뒤집혔다 — 환경이 아니라 코드가 옳다는 걸 증명해야 한다. (N-022)
 */
describe('workDateOf — 어떤 시각이 며칠에 속하는가', () => {
    it('UTC 15:30 은 한국에서 이미 다음 날이다', () => {
        // 이게 이 프로젝트 1순위 예약 버그다. UTC 로 날짜를 뽑으면 하루가 통째로 밀린다.
        const instant = DateTime.fromISO('2026-08-18T15:30:00Z');

        expect(workDateOf(instant)).toBe('2026-08-19');
    });

    it('UTC 14:59 은 아직 같은 날이다 (경계 바로 앞)', () => {
        const instant = DateTime.fromISO('2026-08-18T14:59:59Z');

        expect(workDateOf(instant)).toBe('2026-08-18');
    });

    it('KST 23:59 는 당일이다', () => {
        const instant = DateTime.fromISO('2026-08-18T23:59:00', { zone: APP_ZONE });

        expect(workDateOf(instant)).toBe('2026-08-18');
    });

    it('KST 00:01 은 익일이다', () => {
        const instant = DateTime.fromISO('2026-08-19T00:01:00', { zone: APP_ZONE });

        expect(workDateOf(instant)).toBe('2026-08-19');
    });

    it('입력의 존이 무엇이든 같은 순간이면 같은 답이 나온다', () => {
        const asUtc = DateTime.fromISO('2026-08-18T15:30:00Z');
        const asNewYork = asUtc.setZone('America/New_York');
        const asSeoul = asUtc.setZone(APP_ZONE);

        expect(workDateOf(asNewYork)).toBe(workDateOf(asSeoul));
        expect(workDateOf(asUtc)).toBe(workDateOf(asSeoul));
    });
});

describe('weekStartDateOf — 그 주의 월요일', () => {
    it('수요일이면 그 주 월요일을 돌려준다', () => {
        const wednesday = DateTime.fromISO('2026-08-19T10:00:00', { zone: APP_ZONE });

        expect(weekStartDateOf(wednesday)).toBe('2026-08-17');
    });

    it('월요일 자신은 그대로다', () => {
        const monday = DateTime.fromISO('2026-08-17T00:00:00', { zone: APP_ZONE });

        expect(weekStartDateOf(monday)).toBe('2026-08-17');
    });

    it('일요일은 이전 월요일에 속한다 (주의 마지막 날)', () => {
        // 일요일을 다음 주로 밀면 주간 마감이 하루짜리 주를 만든다.
        const sunday = DateTime.fromISO('2026-08-23T23:59:00', { zone: APP_ZONE });

        expect(weekStartDateOf(sunday)).toBe('2026-08-17');
    });

    it('KST 월요일 00:30 은 그 주에 속한다 — UTC 로는 아직 일요일이다', () => {
        // 주간 마감 크론이 UTC 일요일 19:00 에 도는 이유가 이것이다.
        const mondayEarly = DateTime.fromISO('2026-08-17T00:30:00', { zone: APP_ZONE });
        expect(mondayEarly.toUTC().weekday).toBe(7); // UTC 로는 일요일

        expect(weekStartDateOf(mondayEarly)).toBe('2026-08-17');
    });

    it('해가 바뀌어도 날짜 문자열은 사전순 = 시간순이다', () => {
        const lastWeekOf2026 = DateTime.fromISO('2026-12-31T12:00:00', { zone: APP_ZONE });
        const firstWeekOf2027 = DateTime.fromISO('2027-01-05T12:00:00', { zone: APP_ZONE });

        const earlier = weekStartDateOf(lastWeekOf2026);
        const later = weekStartDateOf(firstWeekOf2027);

        // ISO 주차(2026-W53 vs 2027-W01)였다면 문자열 정렬이 뒤집힌다.
        expect(earlier < later).toBe(true);
    });
});

describe('parseAppDate — 날짜 문자열 해석', () => {
    it("'2026-08-19' 는 한국 시간 0시다 (UTC 자정이 아니다)", () => {
        const parsed = parseAppDate('2026-08-19');

        expect(parsed.hour).toBe(0);
        expect(parsed.zoneName).toBe(APP_ZONE);
        // 같은 순간을 UTC 로 보면 전날 15시다. new Date() 였다면 여기서 하루가 밀렸다.
        expect(parsed.toUTC().toISO()).toBe('2026-08-18T15:00:00.000Z');
    });

    it('형식이 틀리면 조용히 넘어가지 않고 던진다', () => {
        expect(() => parseAppDate('2026-13-45')).toThrow();
        expect(() => parseAppDate('내일')).toThrow();
    });
});

describe('parseAppDateTime / toAppLocalString — API 왕복', () => {
    it('존 표기 없는 로컬 시각을 넣고 빼면 그대로다', () => {
        const original = '2026-08-19T14:00:00';

        const parsed = parseAppDateTime(original);
        const formatted = toAppLocalString(parsed);

        expect(formatted).toBe(original);
    });

    it('UTC 시각을 넣으면 한국 로컬 표기로 나온다', () => {
        const instant = DateTime.fromISO('2026-08-19T05:00:00Z');

        expect(toAppLocalString(instant)).toBe('2026-08-19T14:00:00');
    });
});

describe('minutesUntilMidnight — 자정까지 남은 분', () => {
    it('한국 시간 23:00 이면 60분 남았다', () => {
        const instant = DateTime.fromISO('2026-08-19T23:00:00', { zone: APP_ZONE });

        expect(minutesUntilMidnight(instant)).toBe(60);
    });

    it('한국 시간 0시면 하루가 통째로 남았다', () => {
        const instant = DateTime.fromISO('2026-08-19T00:00:00', { zone: APP_ZONE });

        expect(minutesUntilMidnight(instant)).toBe(1440);
    });

    it('초 단위는 버린다 — 올림하면 자정을 넘긴 예산이 잡힌다', () => {
        const instant = DateTime.fromISO('2026-08-19T23:58:30', { zone: APP_ZONE });

        expect(minutesUntilMidnight(instant)).toBe(1);
    });
});

describe('minutesFromStartOfDay — 하루 안의 분 좌표', () => {
    it('한국 시간 10:00 은 600분이다', () => {
        const instant = DateTime.fromISO('2026-08-19T10:00:00', { zone: APP_ZONE });

        expect(minutesFromStartOfDay(instant)).toBe(600);
    });

    it('UTC 로 준 시각도 한국 기준으로 환산한다', () => {
        // UTC 01:00 = KST 10:00
        const instant = DateTime.fromISO('2026-08-19T01:00:00Z');

        expect(minutesFromStartOfDay(instant)).toBe(600);
    });
});
