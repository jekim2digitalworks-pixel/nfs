import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { settleBlock } from './settlement';
import {
    createBlock,
    pauseBlock,
    resumeBlock,
    type ActiveBlockSnapshot,
    type CreateBlockCommand,
} from './transitions';
import { APP_ZONE } from '../time/zone';

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

function started(overrides: Partial<CreateBlockCommand> = {}): ActiveBlockSnapshot {
    const startTime = (overrides.plannedStartTime ?? at('14:00:00')) as DateTime;
    return createBlock({ ...command(overrides), startImmediately: true }, startTime);
}

/** 원장에 남은 구간의 길이 */
function intervalMinutesOf(startTime: DateTime, endTime: DateTime): number {
    return Math.floor(endTime.diff(startTime, 'minutes').minutes);
}

describe('완료 유형 (정책 §1.2)', () => {
    it('계획을 채우고 완료하면 NORMAL_COMPLETED', () => {
        const block = started();
        const draft = settleBlock(block, at('15:00:00'), 'USER_COMPLETE');

        expect(draft.completionType).toBe('NORMAL_COMPLETED');
        expect(draft.actualFocusMinutes).toBe(60);
    });

    it('계획을 못 채우고 완료하면 EARLY_FINISHED', () => {
        const block = started();
        const draft = settleBlock(block, at('14:20:00'), 'USER_COMPLETE');

        expect(draft.completionType).toBe('EARLY_FINISHED');
        expect(draft.actualFocusMinutes).toBe(20);
    });

    it('사용자가 지우면 ABANDONED', () => {
        const block = started();
        const draft = settleBlock(block, at('14:05:00'), 'USER_ABANDON');

        expect(draft.completionType).toBe('ABANDONED');
    });

    it('자정 배치가 닫으면 AUTO_SETTLED — 신뢰도 낮은 데이터로 구분한다', () => {
        const block = started();
        const draft = settleBlock(block, at('00:05:00', '2026-08-19'), 'MIDNIGHT_BATCH');

        expect(draft.completionType).toBe('AUTO_SETTLED');
    });
});

describe('⭐ 자정 배치가 어제 블록을 닫을 때 (실제로 재현한 버그)', () => {
    it('종료 시각을 계획 종료로 캡한다 — now 로 닫으면 날짜까지 넘어간다', () => {
        // 22:00 에 60분 블록을 시작하고 노트북을 덮은 채 잠들었다.
        // 00:05 에 도는 배치가 now 로 닫으면 22:00–00:05(125분)가 되고 날짜를 넘는다.
        const block = started({ plannedStartTime: at('22:00:00'), plannedMinutes: 60 });
        const draft = settleBlock(block, at('00:05:00', '2026-08-19'), 'MIDNIGHT_BATCH');

        expect(draft.endTime.toISO()).toBe(at('23:00:00').toISO());
        expect(intervalMinutesOf(draft.startTime, draft.endTime)).toBe(60);
    });

    it('⭐ 집중 시간이 구간 길이를 넘지 않는다', () => {
        // 이 캡이 없으면 60분 블록에 125분 집중이 박힌다.
        // "집중 시간 > 그 시간에 실재한 구간"은 통계에 남으면 안 되는 모순이다.
        const block = started({ plannedStartTime: at('22:00:00'), plannedMinutes: 60 });
        const draft = settleBlock(block, at('00:05:00', '2026-08-19'), 'MIDNIGHT_BATCH');

        expect(draft.actualFocusMinutes).toBe(60);
        expect(draft.actualFocusMinutes).toBeLessThanOrEqual(
            intervalMinutesOf(draft.startTime, draft.endTime),
        );
    });

    it('불변식은 모든 방아쇠에서 성립한다', () => {
        const cases: Array<{ trigger: 'USER_COMPLETE' | 'USER_ABANDON' | 'MIDNIGHT_BATCH'; now: DateTime }> = [
            { trigger: 'USER_COMPLETE', now: at('14:20:00') },
            { trigger: 'USER_COMPLETE', now: at('15:00:00') },
            { trigger: 'USER_ABANDON', now: at('14:01:00') },
            { trigger: 'MIDNIGHT_BATCH', now: at('00:05:00', '2026-08-19') },
        ];

        for (const one of cases) {
            const draft = settleBlock(started(), one.now, one.trigger);
            const intervalMinutes = intervalMinutesOf(draft.startTime, draft.endTime);

            expect(draft.actualFocusMinutes).toBeLessThanOrEqual(intervalMinutes);
            expect(draft.actualFocusMinutes).toBeGreaterThanOrEqual(0);
        }
    });

    it('자정을 넘는 블록은 계획 종료 전이면 now 로 닫는다', () => {
        // 23:30–00:30 블록을 00:05 에 정산 → 계획 종료(00:30) 전이므로 now 가 맞다
        const block = started({ plannedStartTime: at('23:30:00'), plannedMinutes: 60 });
        const draft = settleBlock(block, at('00:05:00', '2026-08-19'), 'MIDNIGHT_BATCH');

        expect(draft.endTime.toISO()).toBe(at('00:05:00', '2026-08-19').toISO());
        expect(draft.actualFocusMinutes).toBe(35);
    });
});

describe('#19 타이머를 한 번도 누르지 않은 블록', () => {
    it('시작 시각은 계획 시작 시각을 쓰고 집중은 0분이다', () => {
        const readyBlock = createBlock(command(), at('13:50:00'));
        const draft = settleBlock(readyBlock, at('14:30:00'), 'USER_COMPLETE');

        expect(draft.startTime.toISO()).toBe(at('14:00:00').toISO());
        expect(draft.actualFocusMinutes).toBe(0);
        expect(draft.completionType).toBe('EARLY_FINISHED');
    });

    it('시작 전에 지우면 길이 0 구간이 된다 — 예산을 차지하지 않는다', () => {
        const readyBlock = createBlock(command(), at('13:00:00'));
        const draft = settleBlock(readyBlock, at('13:10:00'), 'USER_ABANDON');

        // now(13:10)가 계획 시작(14:00)보다 이르다 → 종료를 시작으로 당긴다
        expect(draft.startTime.toISO()).toBe(at('14:00:00').toISO());
        expect(draft.endTime.toISO()).toBe(at('14:00:00').toISO());
        expect(intervalMinutesOf(draft.startTime, draft.endTime)).toBe(0);
        expect(draft.actualFocusMinutes).toBe(0);
    });
});

describe('#18 일시정지가 있는 블록', () => {
    it('pauseCount 가 남고 정지 구간은 집중 시간에서 빠진다', () => {
        // 14:00 시작 → 14:10 정지 → 14:20 재개 → 14:35 정지 → 14:40 완료
        let block = started();
        block = pauseBlock(block, at('14:10:00'));
        block = resumeBlock(block, at('14:20:00'));
        block = pauseBlock(block, at('14:35:00'));

        const draft = settleBlock(block, at('14:40:00'), 'USER_COMPLETE');

        expect(draft.pauseCount).toBe(2);
        expect(draft.actualFocusMinutes).toBe(25); // 10 + 15. 쉰 10분은 빠졌다
        expect(draft.completionType).toBe('EARLY_FINISHED');
        // 구간은 40분인데 집중은 25분 — 이게 정상이다
        expect(intervalMinutesOf(draft.startTime, draft.endTime)).toBe(40);
    });

    it('뽀모도로 휴식도 같은 경로를 지난다 (N-019)', () => {
        // 30분 블록 = 집중 25 + 휴식 5. 휴식은 PAUSED 로 들어간다
        let block = started({ plannedMinutes: 30 });
        block = pauseBlock(block, at('14:25:00'));

        const draft = settleBlock(block, at('14:30:00'), 'USER_COMPLETE');

        expect(draft.actualFocusMinutes).toBe(25); // 휴식 5분은 집중이 아니다
        expect(intervalMinutesOf(draft.startTime, draft.endTime)).toBe(30); // 예산은 30분을 쓴다
    });
});

describe('원장에 남는 값', () => {
    it('멱등성 키는 블록 id 다 — 두 번 정산해도 DB 가 막는다', () => {
        const draft = settleBlock(started(), at('15:00:00'), 'USER_COMPLETE');

        expect(draft.sourceType).toBe('NFS_BLOCK');
        expect(draft.sourceReferenceKey).toBe('812');
    });

    it('⭐ statDate 는 시작한 날 하나뿐이다 (자정을 넘어도 쪼개지 않는다)', () => {
        // 예산은 날짜별로 분할 청구하지만, 통계 귀속은 시작한 날에 전부다 (정책 §2.3)
        const block = started({ plannedStartTime: at('23:30:00'), plannedMinutes: 60 });
        const draft = settleBlock(block, at('00:20:00', '2026-08-19'), 'USER_COMPLETE');

        expect(draft.statDate).toBe('2026-08-18');
        expect(draft.endTime.toISO()).toBe(at('00:20:00', '2026-08-19').toISO());
    });

    it('태그는 이관 시점 스냅샷이다', () => {
        const draft = settleBlock(started({ categoryTag: 'STUDY' }), at('15:00:00'), 'USER_COMPLETE');

        expect(draft.categoryTag).toBe('STUDY');
    });

    it('제목이 비어 있으면 비운 채로 남긴다 — 표시명은 화면이 만든다', () => {
        const draft = settleBlock(started({ title: '  ' }), at('15:00:00'), 'USER_COMPLETE');

        expect(draft.title).toBe('');
    });

    it('#20 겹침 차감은 여기서 채우지 않는다 — 예산 계산기의 몫이다', () => {
        const draft = settleBlock(started(), at('15:00:00'), 'USER_COMPLETE');

        // TimeLogDraft 에 overlapDeductedMinutes 가 없는 것이 의도다.
        // 그 값은 다른 블록·캘린더를 다 봐야 알 수 있어서 순수 함수로 만들 수 없다.
        // 서비스(B-06)가 calculateDailyBudget 의 attribution 에서 가져와 채운다.
        expect(draft).not.toHaveProperty('overlapDeductedMinutes');
        expect(draft.plannedMinutes).toBe(60);
    });

    it('정산은 원본 스냅샷을 건드리지 않는다', () => {
        const block = started();
        const before = block.blockStatus;

        settleBlock(block, at('15:00:00'), 'USER_COMPLETE');

        expect(block.blockStatus).toBe(before);
    });
});
