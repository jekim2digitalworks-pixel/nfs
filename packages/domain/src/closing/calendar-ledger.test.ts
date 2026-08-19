import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    buildCalendarLedgerDraft,
    datesSpannedBy,
    isWorthRecording,
    type CalendarEventSnapshot,
} from './calendar-ledger';
import { APP_ZONE } from '../time/zone';

function at(clock: string, dateString = '2026-08-18'): DateTime {
    return DateTime.fromISO(`${dateString}T${clock}`, { zone: APP_ZONE });
}

function event(overrides: Partial<CalendarEventSnapshot> = {}): CalendarEventSnapshot {
    return {
        googleEventId: 'evt_9f3',
        title: '주간 스프린트 회의',
        categoryTag: 'MEETING',
        startTime: at('14:00:00'),
        endTime: at('15:00:00'),
        ...overrides,
    };
}

describe('걸친 날짜', () => {
    it('하루 안에 끝나면 한 날짜다', () => {
        expect(datesSpannedBy(at('14:00:00'), at('15:00:00'))).toEqual(['2026-08-18']);
    });

    it('자정을 넘으면 두 날짜다 — 겹침을 날짜별로 재야 한다', () => {
        const dates = datesSpannedBy(at('23:00:00'), at('01:00:00', '2026-08-19'));

        expect(dates).toEqual(['2026-08-18', '2026-08-19']);
    });

    it('정확히 자정에 끝나면 다음 날은 포함하지 않는다', () => {
        expect(datesSpannedBy(at('22:00:00'), at('00:00:00', '2026-08-19'))).toEqual([
            '2026-08-18',
        ]);
    });

    it('사흘짜리 일정은 네 날짜에 걸친다 — 마지막 날의 09:00 까지가 그 날의 몫이다', () => {
        const dates = datesSpannedBy(at('09:00:00'), at('09:00:00', '2026-08-21'));

        // 블록과 달리 캘린더 일정은 길이 상한이 없다.
        // 72시간짜리라도 "걸친 날짜마다 1440분 상한"을 각각 적용해야 한다
        expect(dates).toEqual(['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']);
    });
});

describe('원장 한 줄 만들기 (데이터모델 §3.2)', () => {
    it('겹치지 않으면 잡아둔 길이가 그대로 남는다', () => {
        const draft = buildCalendarLedgerDraft(event(), 60, 0);

        expect(draft.sourceType).toBe('GOOGLE_CALENDAR');
        expect(draft.completionType).toBe('CALENDAR_IMPORTED');
        expect(draft.sourceReferenceKey).toBe('evt_9f3');
        expect(draft.plannedMinutes).toBe(60);
        expect(draft.actualFocusMinutes).toBe(60);
        expect(draft.overlapDeductedMinutes).toBe(0);
        expect(draft.pauseCount).toBe(0);
    });

    it('⭐ 겹친 만큼 깎인다 — 안 깎으면 이중 예약한 사람의 하루가 30시간이 된다', () => {
        const draft = buildCalendarLedgerDraft(event(), 60, 25);

        expect(draft.actualFocusMinutes).toBe(35);
        expect(draft.overlapDeductedMinutes).toBe(25);
        // 계획(잡아둔 길이)은 깎지 않는다. "얼마를 잡아두고 얼마가 남았나"가 회고 신호다
        expect(draft.plannedMinutes).toBe(60);
    });

    it('블록에 자리를 전부 내주면 0분이 되고, 원장에 넣지 않는다', () => {
        const draft = buildCalendarLedgerDraft(event(), 60, 60);

        expect(draft.actualFocusMinutes).toBe(0);
        expect(isWorthRecording(draft)).toBe(false);
    });

    it('1분이라도 남으면 기록한다', () => {
        const draft = buildCalendarLedgerDraft(event(), 60, 59);

        expect(isWorthRecording(draft)).toBe(true);
    });

    it('⚠️ 겹침이 길이보다 크게 들어와도 음수가 나오지 않는다 (N-030 의 교훈)', () => {
        const draft = buildCalendarLedgerDraft(event(), 60, 90);

        expect(draft.actualFocusMinutes).toBe(0);
        expect(draft.overlapDeductedMinutes).toBe(60);
    });

    it('⚠️ 겹침이 음수로 들어와도 0 으로 막는다', () => {
        const draft = buildCalendarLedgerDraft(event(), 60, -10);

        expect(draft.actualFocusMinutes).toBe(60);
        expect(draft.overlapDeductedMinutes).toBe(0);
    });
});

describe('귀속일 (정책 §2.3)', () => {
    it('시작한 날에 귀속된다', () => {
        const draft = buildCalendarLedgerDraft(event(), 60, 0);

        expect(draft.statDate).toBe('2026-08-18');
    });

    it('⭐ 자정을 넘겨 끝나도 귀속일은 시작한 날이다 — 블록과 같은 규칙', () => {
        const crossing = event({
            startTime: at('23:00:00'),
            endTime: at('01:00:00', '2026-08-19'),
        });
        const draft = buildCalendarLedgerDraft(crossing, 120, 0);

        expect(draft.statDate).toBe('2026-08-18');
        expect(draft.actualFocusMinutes).toBe(120);
    });

    it('⭐ UTC 로 들어온 시각도 KST 날짜로 귀속된다', () => {
        // UTC 2026-08-18T15:30Z 은 한국에서 이미 8월 19일 00:30 이다
        const utcEvent = event({
            startTime: DateTime.fromISO('2026-08-18T15:30:00Z', { zone: 'utc' }),
            endTime: DateTime.fromISO('2026-08-18T16:30:00Z', { zone: 'utc' }),
        });
        const draft = buildCalendarLedgerDraft(utcEvent, 60, 0);

        expect(draft.statDate).toBe('2026-08-19');
    });
});
