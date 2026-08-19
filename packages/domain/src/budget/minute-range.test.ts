import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    clipRangeToDate,
    grossMinutesOf,
    mergeMinuteRanges,
    splitRangeByDate,
    subtractMinuteRanges,
    unionMinutesOf,
    type MinuteRange,
} from './minute-range';
import { APP_ZONE } from '../time/zone';

/** '10:00' → 600. 테스트를 시각으로 읽을 수 있게 한다 */
function at(clock: string): number {
    const parts = clock.split(':');
    const hour = Number(parts[0]);
    const minute = Number(parts[1] ?? '0');
    return hour * 60 + minute;
}

function range(startClock: string, endClock: string): MinuteRange {
    return { startMinute: at(startClock), endMinute: at(endClock) };
}

function instant(dateString: string, clock: string): DateTime {
    return DateTime.fromISO(`${dateString}T${clock}:00`, { zone: APP_ZONE });
}

/**
 * docs/테스트/01-테스트계획.md §2.1 「구간 병합 — 경계값」 8건을 그대로 옮긴다.
 * 번호는 그 문서의 케이스 번호다.
 */
describe('mergeMinuteRanges — 테스트계획 §2.1', () => {
    it('#1 겹침 없음 10-11, 13-14 → 120분', () => {
        const merged = mergeMinuteRanges([range('10:00', '11:00'), range('13:00', '14:00')]);

        expect(grossMinutesOf(merged)).toBe(120);
        expect(merged).toHaveLength(2);
    });

    it('#2 완전 포함 14-16, 14-15 → 120분 (180 아님)', () => {
        const merged = mergeMinuteRanges([range('14:00', '16:00'), range('14:00', '15:00')]);

        expect(grossMinutesOf(merged)).toBe(120);
        expect(merged).toEqual([range('14:00', '16:00')]);
    });

    it('#3 부분 겹침 10-11:30, 10:30-11 → 90분', () => {
        const merged = mergeMinuteRanges([range('10:00', '11:30'), range('10:30', '11:00')]);

        expect(grossMinutesOf(merged)).toBe(90);
    });

    it('#4 ⭐ 경계 접함 10-11, 11-12 → 120분 (중복 계산 없음)', () => {
        // 이 스위트의 핵심. 반열린 구간이라 11:00 은 뒤 구간에만 속한다.
        // <= 로 짰다면 1분이 사라지거나 중복된다.
        const merged = mergeMinuteRanges([range('10:00', '11:00'), range('11:00', '12:00')]);

        expect(grossMinutesOf(merged)).toBe(120);
        // 닿아 있으므로 한 구간으로 합쳐진다. 총 분은 그대로다.
        expect(merged).toEqual([range('10:00', '12:00')]);
    });

    it('#5 3중 겹침 14-16, 14-15, 14:30-15:30 → 120분', () => {
        const merged = mergeMinuteRanges([
            range('14:00', '16:00'),
            range('14:00', '15:00'),
            range('14:30', '15:30'),
        ]);

        expect(grossMinutesOf(merged)).toBe(120);
    });

    it('#6 동일 구간 2개 → 1개분', () => {
        const merged = mergeMinuteRanges([range('09:00', '10:00'), range('09:00', '10:00')]);

        expect(grossMinutesOf(merged)).toBe(60);
        expect(merged).toHaveLength(1);
    });

    it('#7 0분 구간은 무시한다', () => {
        const merged = mergeMinuteRanges([
            range('10:00', '10:00'),
            range('11:00', '12:00'),
            { startMinute: 800, endMinute: 700 }, // 음수 길이도 버린다
        ]);

        expect(grossMinutesOf(merged)).toBe(60);
        expect(merged).toEqual([range('11:00', '12:00')]);
    });

    it('#8 정렬 안 된 입력도 결과가 같다', () => {
        const sortedInput = [range('09:00', '10:00'), range('11:00', '12:00'), range('14:00', '15:00')];
        const shuffledInput = [range('14:00', '15:00'), range('09:00', '10:00'), range('11:00', '12:00')];

        expect(mergeMinuteRanges(shuffledInput)).toEqual(mergeMinuteRanges(sortedInput));
    });

    it('빈 입력은 빈 결과다', () => {
        expect(mergeMinuteRanges([])).toEqual([]);
        expect(unionMinutesOf([])).toBe(0);
    });

    it('입력 배열을 건드리지 않는다', () => {
        const original = [range('10:00', '11:00'), range('10:30', '12:00')];
        const snapshot = JSON.parse(JSON.stringify(original));

        mergeMinuteRanges(original);

        expect(original).toEqual(snapshot);
    });
});

describe('subtractMinuteRanges — 겹친 자리의 귀속을 정한다', () => {
    it('가운데가 잘리면 양쪽이 남는다', () => {
        const remainder = subtractMinuteRanges(range('09:00', '12:00'), [range('10:00', '11:00')]);

        expect(remainder).toEqual([range('09:00', '10:00'), range('11:00', '12:00')]);
    });

    it('완전히 덮이면 아무것도 남지 않는다', () => {
        const remainder = subtractMinuteRanges(range('10:00', '11:00'), [range('09:00', '12:00')]);

        expect(remainder).toEqual([]);
    });

    it('앞이 잘리면 뒤만 남는다', () => {
        const remainder = subtractMinuteRanges(range('10:00', '12:00'), [range('09:00', '11:00')]);

        expect(remainder).toEqual([range('11:00', '12:00')]);
    });

    it('경계만 닿는 구간은 아무것도 깎지 않는다', () => {
        // [10,11) 을 [11,12) 로 빼도 그대로다. 반열린 구간의 정의 그대로.
        const remainder = subtractMinuteRanges(range('10:00', '11:00'), [range('11:00', '12:00')]);

        expect(remainder).toEqual([range('10:00', '11:00')]);
    });

    it('여러 조각으로 잘려도 순서대로 남는다', () => {
        const remainder = subtractMinuteRanges(range('09:00', '15:00'), [
            range('10:00', '11:00'),
            range('12:00', '13:00'),
        ]);

        expect(remainder).toEqual([
            range('09:00', '10:00'),
            range('11:00', '12:00'),
            range('13:00', '15:00'),
        ]);
    });

    it('겹치지 않는 구간을 빼면 그대로다', () => {
        const remainder = subtractMinuteRanges(range('10:00', '11:00'), [range('14:00', '15:00')]);

        expect(remainder).toEqual([range('10:00', '11:00')]);
    });
});

describe('splitRangeByDate — 자정을 넘는 구간 (정책 §2.3)', () => {
    it('#13 23:00–01:00 은 두 날로 갈린다', () => {
        const pieces = splitRangeByDate(instant('2026-08-18', '23:00'), instant('2026-08-19', '01:00'));

        expect(pieces).toEqual([
            { workDate: '2026-08-18', startMinute: 1380, endMinute: 1440 },
            { workDate: '2026-08-19', startMinute: 0, endMinute: 60 },
        ]);
    });

    it('하루 안에 있으면 한 조각이다', () => {
        const pieces = splitRangeByDate(instant('2026-08-18', '10:00'), instant('2026-08-18', '11:30'));

        expect(pieces).toEqual([{ workDate: '2026-08-18', startMinute: 600, endMinute: 690 }]);
    });

    it('정확히 자정에 끝나면 그날 1440으로 닫힌다 (다음 날 0분 조각을 만들지 않는다)', () => {
        const pieces = splitRangeByDate(instant('2026-08-18', '23:00'), instant('2026-08-19', '00:00'));

        expect(pieces).toEqual([{ workDate: '2026-08-18', startMinute: 1380, endMinute: 1440 }]);
    });

    it('사흘에 걸친 캘린더 일정도 날짜별로 갈린다', () => {
        const pieces = splitRangeByDate(instant('2026-08-18', '22:00'), instant('2026-08-20', '02:00'));

        expect(pieces.map((piece) => piece.workDate)).toEqual([
            '2026-08-18',
            '2026-08-19',
            '2026-08-20',
        ]);
        expect(pieces[1]).toEqual({ workDate: '2026-08-19', startMinute: 0, endMinute: 1440 });
    });

    it('끝이 시작보다 이르면 빈 결과다', () => {
        expect(splitRangeByDate(instant('2026-08-18', '12:00'), instant('2026-08-18', '10:00'))).toEqual([]);
    });

    it('UTC 로 들어온 시각도 한국 날짜로 갈린다', () => {
        // UTC 14:00 = KST 23:00 → 18일 60분 + 19일 60분
        const pieces = splitRangeByDate(
            DateTime.fromISO('2026-08-18T14:00:00Z'),
            DateTime.fromISO('2026-08-18T16:00:00Z'),
        );

        expect(pieces).toEqual([
            { workDate: '2026-08-18', startMinute: 1380, endMinute: 1440 },
            { workDate: '2026-08-19', startMinute: 0, endMinute: 60 },
        ]);
    });
});

describe('clipRangeToDate', () => {
    it('그날에 걸친 부분만 남긴다', () => {
        const clipped = clipRangeToDate(
            instant('2026-08-18', '23:00'),
            instant('2026-08-19', '01:00'),
            '2026-08-19',
        );

        expect(clipped).toEqual({ startMinute: 0, endMinute: 60 });
    });

    it('그날에 안 걸치면 null 이다', () => {
        const clipped = clipRangeToDate(
            instant('2026-08-18', '10:00'),
            instant('2026-08-18', '11:00'),
            '2026-08-19',
        );

        expect(clipped).toBeNull();
    });
});
