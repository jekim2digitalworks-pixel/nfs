import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    dateColumnToDateString,
    dateStringToDateColumn,
    instantToDateColumn,
} from './date-column';
import { APP_ZONE } from './zone';

describe('dateStringToDateColumn — 문자열을 DATE 컬럼 값으로', () => {
    it('그 날짜의 UTC 자정이 된다 (한국 시간 0시가 아니다)', () => {
        const column = dateStringToDateColumn('2026-08-19');

        expect(column.toISOString()).toBe('2026-08-19T00:00:00.000Z');
    });

    it('한국 시간 0시로 만들었다면 DATE 컬럼에서 전날로 잘린다 — 그래서 이 규약이 있다', () => {
        // 이 프로젝트 1순위 버그의 재현. 이렇게 하면 안 된다는 걸 테스트로 박아둔다.
        const wrong = DateTime.fromISO('2026-08-19', { zone: APP_ZONE }).startOf('day').toJSDate();

        expect(wrong.toISOString()).toBe('2026-08-18T15:00:00.000Z');
        expect(wrong.toISOString().slice(0, 10)).toBe('2026-08-18'); // ← 하루가 밀렸다
    });

    it('형식이 틀리면 던진다', () => {
        expect(() => dateStringToDateColumn('2026-13-45')).toThrow();
    });
});

describe('dateColumnToDateString — DATE 컬럼 값을 문자열로', () => {
    it('왕복해도 그대로다', () => {
        const original = '2026-08-19';

        expect(dateColumnToDateString(dateStringToDateColumn(original))).toBe(original);
    });

    it('연말 경계도 흔들리지 않는다', () => {
        const original = '2026-12-31';

        expect(dateColumnToDateString(dateStringToDateColumn(original))).toBe(original);
    });
});

describe('instantToDateColumn — 순간 → 날짜 칸', () => {
    it('UTC 15:30 은 한국 기준 다음 날로 기록된다', () => {
        const instant = DateTime.fromISO('2026-08-18T15:30:00Z');

        expect(instantToDateColumn(instant).toISOString()).toBe('2026-08-19T00:00:00.000Z');
    });

    it('UTC 14:59 는 아직 당일이다 (경계 바로 앞)', () => {
        const instant = DateTime.fromISO('2026-08-18T14:59:59Z');

        expect(instantToDateColumn(instant).toISOString()).toBe('2026-08-18T00:00:00.000Z');
    });

    it('한국 시간 23:59 에 만든 블록의 work_date 는 당일이다', () => {
        const instant = DateTime.fromISO('2026-08-18T23:59:00', { zone: APP_ZONE });

        expect(dateColumnToDateString(instantToDateColumn(instant))).toBe('2026-08-18');
    });

    it('한국 시간 00:01 에 만든 블록의 work_date 는 익일이다', () => {
        const instant = DateTime.fromISO('2026-08-19T00:01:00', { zone: APP_ZONE });

        expect(dateColumnToDateString(instantToDateColumn(instant))).toBe('2026-08-19');
    });

    it('입력 존이 무엇이든 같은 순간이면 같은 칸이다', () => {
        const asUtc = DateTime.fromISO('2026-08-18T15:30:00Z');

        const fromUtc = instantToDateColumn(asUtc);
        const fromNewYork = instantToDateColumn(asUtc.setZone('America/New_York'));
        const fromKiritimati = instantToDateColumn(asUtc.setZone('Pacific/Kiritimati'));

        expect(fromNewYork.toISOString()).toBe(fromUtc.toISOString());
        expect(fromKiritimati.toISOString()).toBe(fromUtc.toISOString());
    });
});
