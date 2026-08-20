import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
    assertBlockFitsInBudget,
    assertWithinDailyCap,
    calculateDailyBudget,
    marginalMinutesOf,
    previewWithCandidate,
    withCandidate,
    type BudgetOccupant,
    type DailyBudgetInput,
} from './daily-budget';
import { APP_ZONE } from '../time/zone';
import { isNfsError } from '../errors';
import type { SourceType } from '../types/block';
import type { CategoryTag } from '../types/category-tag';

const WORK_DATE = '2026-08-18';

function instant(clock: string, dateString: string = WORK_DATE): DateTime {
    return DateTime.fromISO(`${dateString}T${clock}:00`, { zone: APP_ZONE });
}

let referenceCounter = 0;

function occupant(
    sourceType: SourceType,
    startClock: string,
    endClock: string,
    categoryTag: CategoryTag = 'DEVELOPMENT',
    options: { startDate?: string; endDate?: string } = {},
): BudgetOccupant {
    referenceCounter = referenceCounter + 1;
    return {
        referenceKey: `ref-${referenceCounter}`,
        sourceType: sourceType,
        categoryTag: categoryTag,
        title: `${sourceType} ${startClock}-${endClock}`,
        startTime: instant(startClock, options.startDate ?? WORK_DATE),
        endTime: instant(endClock, options.endDate ?? WORK_DATE),
    };
}

function block(startClock: string, endClock: string, tag: CategoryTag = 'DEVELOPMENT'): BudgetOccupant {
    return occupant('NFS_BLOCK', startClock, endClock, tag);
}

function calendar(startClock: string, endClock: string, tag: CategoryTag = 'MEETING'): BudgetOccupant {
    return occupant('GOOGLE_CALENDAR', startClock, endClock, tag);
}

function budgetOf(occupants: BudgetOccupant[]): DailyBudgetInput {
    return { workDate: WORK_DATE, occupants: occupants };
}

// ─────────────────────────────────────────────────────────────

describe('정책 §2.1 규칙 2 — 계산은 합집합', () => {
    it('겹치지 않으면 그냥 더한 값이다', () => {
        const result = calculateDailyBudget(budgetOf([block('10:00', '11:00'), calendar('13:00', '14:00')]));

        expect(result.occupiedMinutes).toBe(120);
        expect(result.overlapMinutes).toBe(0);
        expect(result.remainingMinutes).toBe(1320);
    });

    it('겹친 1분은 1분으로만 센다', () => {
        // 블록 10-12(120분) + 캘린더 11-13(120분) = 총합 240분, 합집합 180분
        const result = calculateDailyBudget(budgetOf([block('10:00', '12:00'), calendar('11:00', '13:00')]));

        expect(result.occupiedMinutes).toBe(180);
        expect(result.overlapMinutes).toBe(60);
    });

    it('3중으로 겹쳐도 한 번만 센다', () => {
        const result = calculateDailyBudget(
            budgetOf([calendar('14:00', '16:00'), calendar('14:00', '15:00'), calendar('14:30', '15:30')]),
        );

        expect(result.occupiedMinutes).toBe(120);
        expect(result.overlapMinutes).toBe(120); // 총합 240 − 합집합 120
    });

    it('경계가 닿는 구간은 겹친 것이 아니다', () => {
        // [10,11) 과 [11,12) — 반열린 구간이라 11:00 은 뒤쪽에만 속한다
        const result = calculateDailyBudget(budgetOf([block('10:00', '11:00'), block('11:00', '12:00')]));

        expect(result.occupiedMinutes).toBe(120);
        expect(result.overlapMinutes).toBe(0);
    });
});

describe('정책 §2.1 규칙 4 — 귀속은 실측 우선', () => {
    it('겹친 구간의 태그는 NFS 블록의 것이다', () => {
        // 블록(개발) 10-12 와 캘린더(회의) 11-13 이 11-12 에서 겹친다.
        // 겹친 60분은 개발로 간다 — 타이머가 증명한 것이 일정표의 주장을 이긴다.
        const result = calculateDailyBudget(
            budgetOf([block('10:00', '12:00', 'DEVELOPMENT'), calendar('11:00', '13:00', 'MEETING')]),
        );

        expect(result.blockMinutes).toBe(120);
        expect(result.calendarMinutes).toBe(60);
        expect(result.byTag).toEqual([
            { categoryTag: 'DEVELOPMENT', minutes: 120 },
            { categoryTag: 'MEETING', minutes: 60 },
        ]);
    });

    it('입력 순서가 캘린더 먼저여도 결과가 같다', () => {
        const calendarFirst = calculateDailyBudget(
            budgetOf([calendar('11:00', '13:00', 'MEETING'), block('10:00', '12:00', 'DEVELOPMENT')]),
        );

        expect(calendarFirst.blockMinutes).toBe(120);
        expect(calendarFirst.calendarMinutes).toBe(60);
    });

    it('블록에 완전히 덮인 캘린더 일정은 0분을 가져간다', () => {
        const result = calculateDailyBudget(
            budgetOf([block('09:00', '18:00', 'DEVELOPMENT'), calendar('13:00', '14:00', 'MEETING')]),
        );

        expect(result.calendarMinutes).toBe(0);
        expect(result.occupiedMinutes).toBe(540);

        const meetingAttribution = result.occupants.find((one) => one.categoryTag === 'MEETING');
        expect(meetingAttribution?.attributedMinutes).toBe(0);
        expect(meetingAttribution?.overlapDeductedMinutes).toBe(60);
    });

    it('#20 겹침 60분이 있는 블록은 overlapDeductedMinutes 로 남는다', () => {
        // 블록끼리 겹치는 경우에도 우선순위가 결정적이어야 한다 (먼저 시작한 쪽이 가져간다)
        const first = block('10:00', '12:00');
        const second = block('11:00', '13:00');
        const result = calculateDailyBudget(budgetOf([first, second]));

        const secondAttribution = result.occupants.find((one) => one.referenceKey === second.referenceKey);
        expect(secondAttribution?.grossMinutes).toBe(120);
        expect(secondAttribution?.attributedMinutes).toBe(60);
        expect(secondAttribution?.overlapDeductedMinutes).toBe(60);
    });

    it('태그별 합계의 총합은 항상 점유 합계와 같다', () => {
        const result = calculateDailyBudget(
            budgetOf([
                block('09:00', '12:00', 'DEVELOPMENT'),
                calendar('10:00', '14:00', 'MEETING'),
                calendar('13:00', '16:00', 'STUDY'),
                block('15:00', '17:00', 'HEALTH'),
            ]),
        );

        let sumOfTags = 0;
        for (const tagBudget of result.byTag) {
            sumOfTags = sumOfTags + tagBudget.minutes;
        }

        expect(sumOfTags).toBe(result.occupiedMinutes);
        expect(result.blockMinutes + result.calendarMinutes).toBe(result.occupiedMinutes);
    });
});

describe('정책 §2.1 규칙 3 — 상한은 1440분 (테스트계획 §2.2)', () => {
    /** 0시부터 minutes 분을 통째로 차지하는 캘린더 일정 */
    function occupying(minutes: number): BudgetOccupant {
        const endHour = Math.floor(minutes / 60);
        const endMinute = minutes % 60;
        const endClock = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
        return calendar('00:00', endClock);
    }

    it('점유 1380분 + 겹치지 않는 60분 → 정확히 1440. 통과한다', () => {
        // 하루를 꽉 채우는 것은 초과가 아니다. 막는 것은 1441분부터다.
        const result = calculateDailyBudget(budgetOf([occupying(1380), block('23:00', '24:00')]));

        expect(result.occupiedMinutes).toBe(1440);
        expect(result.remainingMinutes).toBe(0);
        expect(result.exceededMinutes).toBe(0);
        expect(() => assertWithinDailyCap(result)).not.toThrow();
    });

    it('점유는 구조적으로 1440을 넘지 않는다 — 그래서 상한은 등록 시점에 건다 (N-026)', () => {
        // 모든 점유자를 그날 [0,1440) 으로 잘라 넣으므로, 몇 개를 겹쳐 넣든 합집합의 상한은 1440이다.
        // 즉 계산 결과만 보고는 초과를 판정할 수 없다.
        // 그래서 24시간 상한은 assertBlockFitsInBudget 이 **등록 시점에** 건다.
        const absurdlyOvercommitted = budgetOf([
            occupying(1440),
            calendar('00:00', '24:00'),
            block('00:00', '12:00'),
            block('12:00', '24:00'),
            occupant('GOOGLE_CALENDAR', '22:00', '02:00', 'MEETING', {
                startDate: '2026-08-17',
                endDate: WORK_DATE,
            }),
        ]);

        const result = calculateDailyBudget(absurdlyOvercommitted);

        expect(result.occupiedMinutes).toBe(1440);
        expect(result.exceededMinutes).toBe(0);
    });

    it('저장된 값이 1440을 넘는 채로 들어오면 불변식이 던진다 (데이터 사고 방어선)', () => {
        // 계산기가 만들 수 없는 상태여도, 저장된 값을 그대로 넣는 경로(데이터 사고)가 생길 수 있다.
        // 불변식을 코드로 남겨두면 그때 조용히 넘어가지 않는다.
        expect(() =>
            assertWithinDailyCap({
                workDate: WORK_DATE,
                totalMinutes: 1440,
                occupiedMinutes: 1500,
                remainingMinutes: 0,
                exceededMinutes: 60,
                blockMinutes: 1500,
                calendarMinutes: 0,
                overlapMinutes: 0,
                byTag: [],
                occupants: [],
            }),
        ).toThrow();
    });

    it('꽉 찬 하루에는 새로 늘어날 자리가 없다', () => {
        expect(marginalMinutesOf(budgetOf([occupying(1440)]), block('10:00', '10:30'))).toBe(0);
    });
});

describe('⭐ 등록 검증 — 블록 길이 기준 (N-026 · 테스트계획 §2.2 #9·#10)', () => {
    /** 0시부터 minutes 분을 통째로 차지하는 캘린더 일정 */
    function occupying(minutes: number): BudgetOccupant {
        const endHour = Math.floor(minutes / 60);
        const endMinuteOfHour = minutes % 60;
        const endClock = `${String(endHour).padStart(2, '0')}:${String(endMinuteOfHour).padStart(2, '0')}`;
        return calendar('00:00', endClock);
    }

    it('#10 남은 시간과 정확히 같은 길이는 통과한다', () => {
        // 하루를 꽉 채우는 것은 초과가 아니다. 막는 것은 1분이라도 넘을 때다.
        const existing = calculateDailyBudget(budgetOf([occupying(1380)])); // 남은 60
        expect(existing.remainingMinutes).toBe(60);

        expect(() => assertBlockFitsInBudget(existing, block('23:00', '24:00'))).not.toThrow();
    });

    it('#9 남은 시간보다 길면 BUDGET_EXCEEDED', () => {
        const existing = calculateDailyBudget(budgetOf([occupying(1380)])); // 남은 60

        expect(() => assertBlockFitsInBudget(existing, block('22:30', '24:00'))).toThrow(); // 90분
    });

    it('⭐ 겹치는 자리에 놓아도 예산은 길이만큼 쓴다', () => {
        // 이것이 합집합 방식과 갈리는 지점이다.
        // 증가분으로 셌다면 0분이라 무한히 놓을 수 있었고, 캡이 영원히 안 걸렸다.
        const existing = calculateDailyBudget(budgetOf([occupying(1440)])); // 남은 0
        expect(existing.remainingMinutes).toBe(0);

        expect(() => assertBlockFitsInBudget(existing, block('10:00', '11:00'))).toThrow();
    });

    it('사용자가 말한 시나리오 — 캘린더 20시간(겹침 없음) + 우리 4시간', () => {
        const existing = calculateDailyBudget(budgetOf([occupying(20 * 60)]));
        expect(existing.remainingMinutes).toBe(4 * 60);

        // 3시간 블록 → 통과
        expect(() => assertBlockFitsInBudget(existing, block('20:00', '23:00'))).not.toThrow();

        // 그 블록을 등록한 뒤에는 남은 60분. 다음 3시간 블록은 막힌다
        const afterFirst = calculateDailyBudget(
            withCandidate(budgetOf([occupying(20 * 60)]), block('20:00', '23:00')),
        );
        expect(afterFirst.remainingMinutes).toBe(60);
        expect(() => assertBlockFitsInBudget(afterFirst, block('21:00', '24:00'))).toThrow();
    });

    it('#11 이 여전히 성립한다 — 겹침 많은 사용자를 배제하지 않는다', () => {
        // 캘린더 총 20시간이지만 7시간이 겹쳐 합집합 13시간 → 남은 11시간
        const existing = calculateDailyBudget(
            budgetOf([calendar('06:00', '19:00'), calendar('09:00', '16:00')]),
        );
        expect(existing.remainingMinutes).toBe(11 * 60);

        expect(() => assertBlockFitsInBudget(existing, block('20:00', '23:00'))).not.toThrow();
    });

    it('자정을 넘는 블록은 그날 몫만 청구된다 (정책 §2.3)', () => {
        const existing = calculateDailyBudget(budgetOf([occupying(1380)])); // 남은 60
        const overnight = occupant('NFS_BLOCK', '23:00', '01:00', 'DEVELOPMENT', {
            endDate: '2026-08-19',
        });

        // 오늘 몫은 60분뿐이므로 통과한다 (블록 전체 길이 120분이 아니다)
        expect(() => assertBlockFitsInBudget(existing, overnight)).not.toThrow();
    });

    it('그날에 안 걸치는 블록은 그 날의 예산을 쓰지 않는다', () => {
        const existing = calculateDailyBudget(budgetOf([occupying(1440)])); // 남은 0
        const tomorrow = occupant('NFS_BLOCK', '10:00', '11:00', 'DEVELOPMENT', {
            startDate: '2026-08-19',
            endDate: '2026-08-19',
        });

        expect(() => assertBlockFitsInBudget(existing, tomorrow)).not.toThrow();
    });

    it('거부할 때 무엇이 자리를 차지하는지 함께 알려준다 (정책 §2.4)', () => {
        const existing = calculateDailyBudget(budgetOf([occupying(1440)]));

        let caught: unknown = null;
        try {
            assertBlockFitsInBudget(existing, block('10:00', '11:00'));
        } catch (error) {
            caught = error;
        }

        expect(isNfsError(caught)).toBe(true);
        if (isNfsError(caught)) {
            expect(caught.code).toBe('BUDGET_EXCEEDED');
            // 화면이 "무엇을 빼시겠습니까"를 바로 보여줄 수 있어야 한다.
            // 우리는 사용자에게 구글 캘린더를 고치라고 요구하지 않는다.
            const occupiedBy = caught.detail?.['occupiedBy'] as unknown[];
            expect(occupiedBy.length).toBeGreaterThan(0);
            expect(caught.detail?.['remainingMinutes']).toBe(0);
            expect(caught.detail?.['requestedMinutes']).toBe(60);
        }
    });
});

describe('정책 §2.1 규칙 1 — 배치는 자유 (테스트계획 §2.2 #11·#12)', () => {
    it('#11 ⭐ 캘린더 20시간(겹침 7시간) → 실점유 13시간. 11시간이 남는다', () => {
        // 이 규칙의 존재 이유. 단순 합산이면 여기서 사용자가 앱에서 차단된다.
        // 06:00-19:00 (13시간) + 09:00-16:00 (7시간, 완전히 겹침) = 총합 20시간
        const input = budgetOf([calendar('06:00', '19:00'), calendar('09:00', '16:00')]);
        const result = calculateDailyBudget(input);

        expect(result.occupiedMinutes).toBe(13 * 60);
        expect(result.overlapMinutes).toBe(7 * 60);
        expect(result.remainingMinutes).toBe(11 * 60);
    });

    it('#12 겹치는 자리에 블록을 놓아도 증가분만 청구된다', () => {
        const existing = budgetOf([calendar('10:00', '12:00')]);

        // 캘린더가 이미 찬 10-11 자리에 블록을 놓는다 → 증가분 0
        expect(marginalMinutesOf(existing, block('10:00', '11:00'))).toBe(0);

        // 반만 겹치는 11-13 → 12-13 만 새로 찬다
        expect(marginalMinutesOf(existing, block('11:00', '13:00'))).toBe(60);
    });

    it('꽉 찬 하루에도 겹치는 자리에는 블록을 놓을 수 있다', () => {
        const fullDay = budgetOf([calendar('00:00', '24:00')]);
        const withBlock = withCandidate(fullDay, block('10:00', '11:00'));
        const result = calculateDailyBudget(withBlock);

        expect(result.occupiedMinutes).toBe(1440);
        expect(result.exceededMinutes).toBe(0);
        expect(() => assertWithinDailyCap(result)).not.toThrow();

        // 그리고 그 1시간은 캘린더가 아니라 블록의 태그로 집계된다 (규칙 4)
        expect(result.blockMinutes).toBe(60);
        expect(result.calendarMinutes).toBe(1380);
    });
});

describe('정책 §2.3 — 자정을 넘는 블록 (테스트계획 §2.3 #13)', () => {
    it('#13 23:00–01:00 은 두 날에 60분씩 분할 청구된다', () => {
        const overnight = occupant('NFS_BLOCK', '23:00', '01:00', 'DEVELOPMENT', {
            endDate: '2026-08-19',
        });

        const firstDay = calculateDailyBudget({ workDate: '2026-08-18', occupants: [overnight] });
        const secondDay = calculateDailyBudget({ workDate: '2026-08-19', occupants: [overnight] });

        expect(firstDay.occupiedMinutes).toBe(60);
        expect(secondDay.occupiedMinutes).toBe(60);
    });

    it('대상 날짜에 안 걸치는 점유자는 아예 빠진다', () => {
        const yesterday = occupant('NFS_BLOCK', '10:00', '11:00', 'DEVELOPMENT', {
            startDate: '2026-08-17',
            endDate: '2026-08-17',
        });

        const result = calculateDailyBudget(budgetOf([yesterday]));

        expect(result.occupiedMinutes).toBe(0);
        expect(result.occupants).toHaveLength(0);
    });
});

describe('출력 규약', () => {
    it('점유자가 없으면 하루가 통째로 남는다', () => {
        const result = calculateDailyBudget(budgetOf([]));

        expect(result.totalMinutes).toBe(1440);
        expect(result.occupiedMinutes).toBe(0);
        expect(result.remainingMinutes).toBe(1440);
        expect(result.byTag).toEqual([]);
    });

    it('태그 목록은 많이 쓴 순이다 (링·목록이 이 순서를 쓴다)', () => {
        const result = calculateDailyBudget(
            budgetOf([
                block('09:00', '10:00', 'HEALTH'),
                block('10:00', '13:00', 'DEVELOPMENT'),
                block('13:00', '15:00', 'STUDY'),
            ]),
        );

        expect(result.byTag.map((one) => one.categoryTag)).toEqual([
            'DEVELOPMENT',
            'STUDY',
            'HEALTH',
        ]);
    });

    it('BUDGET_EXCEEDED 는 사용자에게 보여줄 한국어 문구를 담는다', () => {
        const error = (() => {
            try {
                assertWithinDailyCap({
                    workDate: WORK_DATE,
                    totalMinutes: 1440,
                    occupiedMinutes: 1500,
                    remainingMinutes: 0,
                    exceededMinutes: 60,
                    blockMinutes: 1500,
                    calendarMinutes: 0,
                    overlapMinutes: 0,
                    byTag: [],
                    occupants: [],
                });
                return null;
            } catch (caught) {
                return caught;
            }
        })();

        expect(isNfsError(error)).toBe(true);
        if (isNfsError(error)) {
            expect(error.code).toBe('BUDGET_EXCEEDED');
            expect(error.message).toBe('오늘은 더 넣을 자리가 없습니다');
            expect(error.detail?.['occupiedBy']).toEqual([]);
        }
    });
});

// ─────────────────────────────────────────────────────────────

describe('⭐ 생성 시트 미리보기 — 서버 검증과 같은 판정이어야 한다 (S-05 · U-06)', () => {
    /** 0시부터 minutes 분을 통째로 차지하는 캘린더 일정 */
    function occupying(minutes: number): BudgetOccupant {
        const endHour = Math.floor(minutes / 60);
        const endMinuteOfHour = minutes % 60;
        const endClock = `${String(endHour).padStart(2, '0')}:${String(endMinuteOfHour).padStart(2, '0')}`;
        return calendar('00:00', endClock);
    }

    it('빈 자리에 놓으면 그 길이만큼 줄어든다', () => {
        const preview = previewWithCandidate(budgetOf([]), block('10:00', '11:00'));

        expect(preview.requestedMinutes).toBe(60);
        expect(preview.remainingAfterMinutes).toBe(1440 - 60);
        expect(preview.isExceeded).toBe(false);
    });

    it('⭐ 겹치는 자리에 놓으면 남는 시간은 겹친 만큼만 줄어든다 (합집합)', () => {
        // 화면이 "60분 줄어든다"고 말하면 미터와 숫자가 어긋난다.
        // 남는 시간은 **합집합** 기준이고, 요구량(requested)은 **길이** 기준이다 — 둘은 다른 값이다
        const input = budgetOf([calendar('10:00', '11:00')]);
        const preview = previewWithCandidate(input, block('10:30', '11:30'));

        expect(preview.requestedMinutes).toBe(60); // 예산 검증이 청구하는 값
        expect(preview.remainingAfterMinutes).toBe(1440 - 90); // 실제로 점유가 늘어난 값
        expect(preview.isExceeded).toBe(false);
    });

    it('남은 시간과 정확히 같으면 아직 초과가 아니다 (경계)', () => {
        const preview = previewWithCandidate(budgetOf([occupying(1380)]), block('23:00', '24:00'));

        expect(preview.before.remainingMinutes).toBe(60);
        expect(preview.isExceeded).toBe(false);
        expect(preview.remainingAfterMinutes).toBe(0);
    });

    it('1분이라도 넘으면 초과다 (경계)', () => {
        const preview = previewWithCandidate(budgetOf([occupying(1380)]), block('22:59', '24:00'));

        expect(preview.requestedMinutes).toBe(61);
        expect(preview.isExceeded).toBe(true);
        // ⭐ 음수를 그대로 보여준다. 0 으로 접으면 "얼마나 넘었는지"가 사라진다
        expect(preview.remainingAfterMinutes).toBe(-1);
    });

    it('⭐ 초과 판정이 서버의 assertBlockFitsInBudget 과 일치한다', () => {
        // 이 테스트가 깨지면 화면이 "만들 수 있다"고 말한 걸 서버가 거절하기 시작한다
        const cases: Array<[BudgetOccupant, number]> = [
            [block('23:00', '24:00'), 1380],
            [block('22:30', '24:00'), 1380],
            [block('10:00', '11:00'), 1440],
            [block('09:00', '12:00'), 0],
        ];

        for (const [candidate, occupiedMinutes] of cases) {
            const occupants = occupiedMinutes > 0 ? [occupying(occupiedMinutes)] : [];
            const input = budgetOf(occupants);
            const preview = previewWithCandidate(input, candidate);

            let serverRejected = false;
            try {
                assertBlockFitsInBudget(calculateDailyBudget(input), candidate);
            } catch {
                serverRejected = true;
            }

            expect(preview.isExceeded).toBe(serverRejected);
        }
    });

    it('자정을 넘는 블록은 오늘 몫만 청구된다 (정책 §2.3)', () => {
        const overnight = occupant('NFS_BLOCK', '23:00', '01:00', 'DEVELOPMENT', {
            endDate: '2026-08-19',
        });
        const preview = previewWithCandidate(budgetOf([occupying(1380)]), overnight);

        expect(preview.requestedMinutes).toBe(60); // 120분이 아니다
        expect(preview.isExceeded).toBe(false);
    });

    it('그날에 안 걸치는 블록은 오늘 예산을 전혀 쓰지 않는다', () => {
        const tomorrow = occupant('NFS_BLOCK', '10:00', '11:00', 'DEVELOPMENT', {
            startDate: '2026-08-19',
            endDate: '2026-08-19',
        });
        const preview = previewWithCandidate(budgetOf([occupying(1440)]), tomorrow);

        expect(preview.requestedMinutes).toBe(0);
        expect(preview.isExceeded).toBe(false);
    });
});
