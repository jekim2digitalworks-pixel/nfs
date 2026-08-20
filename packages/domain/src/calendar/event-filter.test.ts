import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    classifyEvent,
    eventMinutesOf,
    mapCategoryTag,
    type CalendarEventCandidate,
} from './event-filter';
import { APP_ZONE } from '../time/zone';
import type { CategoryTag } from '../types/category-tag';

function at(clock: string, dateString = '2026-08-18'): DateTime {
    return DateTime.fromISO(`${dateString}T${clock}`, { zone: APP_ZONE });
}

function event(overrides: Partial<CalendarEventCandidate> = {}): CalendarEventCandidate {
    return {
        googleEventId: 'evt_1',
        title: '주간 스프린트 회의',
        startTime: at('14:00:00'),
        endTime: at('15:00:00'),
        isAllDay: false,
        isDeclinedByMe: false,
        isWrittenByNfs: false,
        colorId: null,
        ...overrides,
    };
}

describe('읽기 필터 (정책 §4.2)', () => {
    it('평범한 일정은 통과한다', () => {
        expect(classifyEvent(event())).toEqual({ excluded: false, reason: null });
    });

    it('#1 종일 일정은 뺀다 — 하나에 24시간이 꽂힌다', () => {
        const decision = classifyEvent(
            event({ isAllDay: true, startTime: at('00:00:00'), endTime: at('00:00:00', '2026-08-19') }),
        );

        expect(decision).toEqual({ excluded: true, reason: 'ALL_DAY' });
    });

    it('#3 참석을 거절한 회의는 뺀다 — 안 간 회의는 내 시간이 아니다', () => {
        expect(classifyEvent(event({ isDeclinedByMe: true }))).toEqual({
            excluded: true,
            reason: 'DECLINED',
        });
    });

    it('#4 8시간을 넘으면 뺀다', () => {
        const decision = classifyEvent(
            event({ startTime: at('09:00:00'), endTime: at('17:01:00') }),
        );

        expect(decision).toEqual({ excluded: true, reason: 'TOO_LONG' });
    });

    it('#4 정확히 8시간은 아직 통과한다 (경계)', () => {
        const decision = classifyEvent(event({ startTime: at('09:00:00'), endTime: at('17:00:00') }));

        expect(decision.excluded).toBe(false);
    });

    it('⭐ #5 NFS 가 쓴 일정은 뺀다 — 에코 루프 차단', () => {
        // 이걸 놓치면 우리가 쓴 블록을 다시 읽어 같은 시간이 두 번 잡힌다
        expect(classifyEvent(event({ isWrittenByNfs: true }))).toEqual({
            excluded: true,
            reason: 'NFS_ORIGIN',
        });
    });

    it('#7 색상이 없어도 버리지 않는다 — 미분류로 수집한다', () => {
        expect(classifyEvent(event({ colorId: null })).excluded).toBe(false);
    });

    it('⚠️ 종일이면서 8시간을 넘으면 사유는 ALL_DAY 다 — 설명이 더 정확하다', () => {
        const decision = classifyEvent(
            event({ isAllDay: true, startTime: at('00:00:00'), endTime: at('00:00:00', '2026-08-20') }),
        );

        expect(decision.reason).toBe('ALL_DAY');
    });

    it('길이를 분으로 잰다 (초는 버린다)', () => {
        expect(eventMinutesOf(event({ startTime: at('14:00:00'), endTime: at('15:30:40') }))).toBe(90);
    });
});

describe('태그 매핑 (정책 §4.3)', () => {
    const colorMap = new Map<string, CategoryTag>([
        ['9', 'DEVELOPMENT'],
        ['11', 'MEETING'],
    ]);

    it('색상이 매핑돼 있으면 그 태그다 — 사용자의 명시적 의도에 가장 가깝다', () => {
        expect(mapCategoryTag('9', colorMap)).toBe('DEVELOPMENT');
    });

    it('매핑되지 않은 색은 미분류다', () => {
        expect(mapCategoryTag('4', colorMap)).toBe('UNCATEGORIZED');
    });

    it('색이 없으면 미분류다 — 버리지 않고 "분류 안 된 시간"으로 남긴다', () => {
        expect(mapCategoryTag(null, colorMap)).toBe('UNCATEGORIZED');
    });
});
