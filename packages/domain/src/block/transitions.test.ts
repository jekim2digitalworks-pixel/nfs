import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    createBlock,
    focusMinutesAt,
    focusSecondsAt,
    hasCompletedPlannedFocus,
    pauseBlock,
    plannedEndTimeOf,
    resumeBlock,
    startBlock,
    type ActiveBlockSnapshot,
    type CreateBlockCommand,
} from './transitions';
import { pomodoroCyclesOf } from './validation';
import { APP_ZONE } from '../time/zone';
import { isNfsError } from '../errors';

function at(clock: string, dateString = '2026-08-18'): DateTime {
    return DateTime.fromISO(`${dateString}T${clock}`, { zone: APP_ZONE });
}

function command(overrides: Partial<CreateBlockCommand> = {}): CreateBlockCommand {
    return {
        activeBlockId: '812',
        title: '설계 문서 정리',
        categoryTag: 'DEVELOPMENT',
        plannedStartTime: at('14:00:00'),
        plannedMinutes: 60,
        startImmediately: false,
        ...overrides,
    };
}

describe('createBlock — 생성 규칙 (정책 §1.1)', () => {
    it('기본은 READY 로 만들어진다', () => {
        const block = createBlock(command(), at('13:50:00'));

        expect(block.blockStatus).toBe('READY');
        expect(block.actualStartTime).toBeNull();
        expect(block.accumulatedFocusSeconds).toBe(0);
        expect(block.pauseCount).toBe(0);
    });

    it('startImmediately 면 바로 RUNNING 이다', () => {
        const block = createBlock(command({ startImmediately: true }), at('14:00:00'));

        expect(block.blockStatus).toBe('RUNNING');
        expect(block.actualStartTime?.toISO()).toBe(at('14:00:00').toISO());
        expect(block.lastResumedTime?.toISO()).toBe(at('14:00:00').toISO());
    });

    it('태그가 없으면 CATEGORY_REQUIRED — 원장에 기록될 수 없으므로 생성을 막는다', () => {
        let caught: unknown = null;
        try {
            createBlock(command({ categoryTag: '' as never }), at('13:50:00'));
        } catch (error) {
            caught = error;
        }

        expect(isNfsError(caught)).toBe(true);
        if (isNfsError(caught)) {
            expect(caught.code).toBe('CATEGORY_REQUIRED');
        }
    });

    it('30분 배수가 아니면 거부한다', () => {
        expect(() => createBlock(command({ plannedMinutes: 45 }), at('13:50:00'))).toThrow();
        expect(() => createBlock(command({ plannedMinutes: 1 }), at('13:50:00'))).toThrow();
    });

    it('30분 미만 · 180분 초과를 거부한다 (경계는 통과)', () => {
        expect(() => createBlock(command({ plannedMinutes: 0 }), at('13:50:00'))).toThrow();
        expect(() => createBlock(command({ plannedMinutes: 210 }), at('13:50:00'))).toThrow();

        expect(() => createBlock(command({ plannedMinutes: 30 }), at('13:50:00'))).not.toThrow();
        expect(() => createBlock(command({ plannedMinutes: 180 }), at('13:50:00'))).not.toThrow();
    });

    it('30분 격자에 정렬되지 않은 시작을 거부한다', () => {
        expect(() =>
            createBlock(command({ plannedStartTime: at('14:07:00') }), at('13:50:00')),
        ).toThrow();
        expect(() =>
            createBlock(command({ plannedStartTime: at('14:00:30') }), at('13:50:00')),
        ).toThrow();

        expect(() =>
            createBlock(command({ plannedStartTime: at('14:30:00') }), at('13:50:00')),
        ).not.toThrow();
    });

    it('제목을 비우면 빈 문자열로 둔다 — 표시명은 화면이 만든다', () => {
        const block = createBlock(command({ title: '   ' }), at('13:50:00'));

        // 서버가 한국어 표시명("개발")을 원장에 박으면 나중에 문구를 못 바꾼다
        expect(block.title).toBe('');
    });

    it('⭐ work_date 는 계획 시작 시각 기준이다 (생성 시각이 아니다)', () => {
        // 23:50 에 내일 09:00 블록을 만든다 → 내일 자정 배치의 몫이다
        const block = createBlock(
            command({ plannedStartTime: at('09:00:00', '2026-08-19') }),
            at('23:50:00', '2026-08-18'),
        );

        expect(block.workDate).toBe('2026-08-19');
    });
});

describe('상태 전이 (정책 §1.2)', () => {
    function runningBlock(startedAt: DateTime): ActiveBlockSnapshot {
        return createBlock(command({ startImmediately: true }), startedAt);
    }

    it('READY → RUNNING', () => {
        const ready = createBlock(command(), at('13:50:00'));
        const running = startBlock(ready, at('14:00:00'));

        expect(running.blockStatus).toBe('RUNNING');
        expect(running.actualStartTime?.toISO()).toBe(at('14:00:00').toISO());
    });

    it('RUNNING → PAUSED 에서 누적 집중 초가 확정된다', () => {
        const running = runningBlock(at('14:00:00'));
        const paused = pauseBlock(running, at('14:07:33'));

        expect(paused.blockStatus).toBe('PAUSED');
        expect(paused.accumulatedFocusSeconds).toBe(453); // 7분 33초
        expect(paused.lastResumedTime).toBeNull();
        expect(paused.pauseCount).toBe(1);
    });

    it('PAUSED → RUNNING 은 누적을 건드리지 않는다', () => {
        const paused = pauseBlock(runningBlock(at('14:00:00')), at('14:10:00'));
        const resumed = resumeBlock(paused, at('14:15:00'));

        expect(resumed.blockStatus).toBe('RUNNING');
        expect(resumed.accumulatedFocusSeconds).toBe(600);
        expect(resumed.lastResumedTime?.toISO()).toBe(at('14:15:00').toISO());
    });

    it('재개해도 actualStartTime 은 처음 값 그대로다 (원장의 startTime 이 여기서 온다)', () => {
        const running = runningBlock(at('14:00:00'));
        const resumed = resumeBlock(pauseBlock(running, at('14:10:00')), at('14:20:00'));

        expect(resumed.actualStartTime?.toISO()).toBe(at('14:00:00').toISO());
    });

    it('#18 일시정지 2회 후에도 정지 구간은 집중 시간에 안 들어간다', () => {
        // 14:00 시작 → 14:10 정지(10분) → 14:20 재개 → 14:35 정지(15분)
        let block = runningBlock(at('14:00:00'));
        block = pauseBlock(block, at('14:10:00'));
        block = resumeBlock(block, at('14:20:00'));
        block = pauseBlock(block, at('14:35:00'));

        expect(block.pauseCount).toBe(2);
        expect(block.accumulatedFocusSeconds).toBe(25 * 60); // 10 + 15, 쉰 10분은 빠졌다
    });

    it('잘못된 전이는 ILLEGAL_BLOCK_STATE 로 막는다', () => {
        const ready = createBlock(command(), at('13:50:00'));
        const running = runningBlock(at('14:00:00'));
        const paused = pauseBlock(running, at('14:10:00'));

        expect(() => pauseBlock(ready, at('14:00:00'))).toThrow(); // READY 는 멈출 수 없다
        expect(() => resumeBlock(running, at('14:10:00'))).toThrow(); // 이미 돌고 있다
        expect(() => startBlock(paused, at('14:20:00'))).toThrow(); // 시작은 한 번뿐이다

        let caught: unknown = null;
        try {
            pauseBlock(ready, at('14:00:00'));
        } catch (error) {
            caught = error;
        }
        expect(isNfsError(caught)).toBe(true);
        if (isNfsError(caught)) {
            expect(caught.code).toBe('ILLEGAL_BLOCK_STATE');
        }
    });

    it('전이 함수는 원본 스냅샷을 건드리지 않는다', () => {
        const running = runningBlock(at('14:00:00'));
        const before = running.accumulatedFocusSeconds;

        pauseBlock(running, at('14:10:00'));

        expect(running.accumulatedFocusSeconds).toBe(before);
        expect(running.blockStatus).toBe('RUNNING');
    });
});

describe('집중 시간 계산 (정책 §1.3)', () => {
    function runningBlock(startedAt: DateTime): ActiveBlockSnapshot {
        return createBlock(command({ startImmediately: true }), startedAt);
    }

    it('RUNNING 이면 누적 + 마지막 재개 이후를 더한다', () => {
        const running = runningBlock(at('14:00:00'));

        expect(focusSecondsAt(running, at('14:07:33'))).toBe(453);
        expect(focusMinutesAt(running, at('14:07:33'))).toBe(7); // 초는 버린다
    });

    it('PAUSED 면 누적값에서 멈춘다 — 시간이 흘러도 늘지 않는다', () => {
        const paused = pauseBlock(runningBlock(at('14:00:00')), at('14:10:00'));

        expect(focusSecondsAt(paused, at('14:10:00'))).toBe(600);
        expect(focusSecondsAt(paused, at('15:00:00'))).toBe(600);
        expect(focusSecondsAt(paused, at('23:59:00'))).toBe(600);
    });

    it('READY 면 0이다', () => {
        const ready = createBlock(command(), at('13:50:00'));

        expect(focusSecondsAt(ready, at('20:00:00'))).toBe(0);
    });

    it('초는 올리지 않고 버린다 — 올리면 하루 합계가 부풀어 오른다', () => {
        const running = runningBlock(at('14:00:00'));

        expect(focusMinutesAt(running, at('14:00:59'))).toBe(0);
        expect(focusMinutesAt(running, at('14:01:00'))).toBe(1);
        expect(focusMinutesAt(running, at('14:01:59'))).toBe(1);
    });

    it('저장된 lastResumedTime 이 미래여도 음수가 되지 않는다 (데이터 사고 방어)', () => {
        const running = runningBlock(at('14:00:00'));

        // 집중 시간이 음수가 되면 통계가 조용히 망가진다
        expect(focusSecondsAt(running, at('13:00:00'))).toBe(0);
    });
});

describe('계획 시간 도달 판정', () => {
    function runningBlock(startedAt: DateTime): ActiveBlockSnapshot {
        return createBlock(command({ startImmediately: true, plannedMinutes: 30 }), startedAt);
    }

    it('⭐ 벽시계가 아니라 집중 시간으로 판단한다', () => {
        // 14:00 시작 → 14:10 정지 → 14:40 재개 (30분 쉼)
        let block = runningBlock(at('14:00:00'));
        block = pauseBlock(block, at('14:10:00'));
        block = resumeBlock(block, at('14:40:00'));

        // 15:00 이면 벽시계로는 60분이 지났지만 집중은 30분이다
        expect(hasCompletedPlannedFocus(block, at('14:59:00'))).toBe(false); // 집중 29분
        expect(hasCompletedPlannedFocus(block, at('15:00:00'))).toBe(true); // 집중 30분
    });

    it('plannedEndTimeOf 는 시작 + 길이다', () => {
        const block = createBlock(command({ plannedMinutes: 90 }), at('13:50:00'));

        expect(plannedEndTimeOf(block).toISO()).toBe(at('15:30:00').toISO());
    });
});

describe('뽀모도로 사이클 (정책 §1.4)', () => {
    it('30분당 1사이클이다', () => {
        expect(pomodoroCyclesOf(30)).toBe(1);
        expect(pomodoroCyclesOf(60)).toBe(2);
        expect(pomodoroCyclesOf(90)).toBe(3);
        expect(pomodoroCyclesOf(180)).toBe(6);
    });
});
