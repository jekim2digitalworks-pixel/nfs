import type { DateTime } from 'luxon';
import { totalMinutesPerDay } from '../time/zone';
import type { SourceType } from '../types/block';
import type { CategoryTag } from '../types/category-tag';
import { budgetExceeded } from '../errors';
import {
    clipRangeToDate,
    grossMinutesOf,
    lengthOfRange,
    mergeMinuteRanges,
    subtractMinuteRanges,
    type MinuteRange,
} from './minute-range';

/**
 * 24시간 예산 계산기 (정책 §2 · B-05)
 *
 * ⭐ **등록 검증과 통계 집계가 이 계산기 하나를 같이 쓴다.**
 *    계산기가 두 벌이면 하루 화면의 "남은 시간"과 리포트의 합계가 어긋난다.
 *    이 프로젝트에서 가장 조용하고 치명적인 버그가 거기서 난다.
 *
 * 정책 §2.1 의 4줄을 그대로 구현한다:
 *   1. 배치는 자유    — 겹치는 자리에도 블록을 놓을 수 있다 (이 계산기는 막지 않는다)
 *   2. 계산은 합집합  — 겹친 1분은 몇 개가 겹치든 1분이다
 *   3. 상한은 1440분  — 합집합 기준
 *   4. 귀속은 실측 우선 — 겹친 구간의 태그는 NFS 블록의 것
 */

/** 예산을 차지하는 것 하나. 블록이든 캘린더 일정이든 여기로 정규화해서 넣는다 */
export interface BudgetOccupant {
    /** 화면이 항목을 식별하는 키. ActiveBlock id 나 구글 이벤트 id */
    referenceKey: string;
    sourceType: SourceType;
    categoryTag: CategoryTag;
    title: string;
    startTime: DateTime;
    endTime: DateTime;
}

export interface DailyBudgetInput {
    /** 'yyyy-MM-dd' */
    workDate: string;
    occupants: readonly BudgetOccupant[];
}

/** 점유자 하나가 실제로 얼마를 차지했는가 */
export interface OccupantAttribution {
    referenceKey: string;
    sourceType: SourceType;
    categoryTag: CategoryTag;
    title: string;
    /** 그날에 걸친 부분의 길이 */
    grossMinutes: number;
    /** 겹침을 제외하고 실제로 자기 몫이 된 분 */
    attributedMinutes: number;
    /** 겹쳐서 남에게 넘어간 분. TimeLog.overlapDeductedMinutes 가 이 값이다 */
    overlapDeductedMinutes: number;
}

export interface TagBudget {
    categoryTag: CategoryTag;
    minutes: number;
}

export interface DailyBudgetResult {
    workDate: string;
    /** 항상 1440 */
    totalMinutes: number;
    /** 합집합 기준 점유 */
    occupiedMinutes: number;
    /** 1440 − 점유. 초과했으면 0 (음수를 내보내지 않는다) */
    remainingMinutes: number;
    /** 1440 을 넘은 분. 넘지 않았으면 0 */
    exceededMinutes: number;
    /** NFS 블록 귀속 (실측 우선이므로 겹쳐도 깎이지 않는다) */
    blockMinutes: number;
    /** 캘린더 귀속 — 블록과 겹친 부분을 뺀 나머지 */
    calendarMinutes: number;
    /** 겹쳐서 한 번만 센 분. 화면이 "겹친 N분은 한 번만 셌습니다"를 표시한다 */
    overlapMinutes: number;
    byTag: TagBudget[];
    occupants: OccupantAttribution[];
}

/**
 * 귀속 우선순위. 낮을수록 먼저 자리를 차지한다.
 *
 * 정책 §2.1 규칙 4 — **타이머가 증명한 것이 일정표의 주장을 이긴다.**
 * 겹친 자리는 NFS 블록의 태그로 집계된다.
 */
function attributionPriorityOf(sourceType: SourceType): number {
    if (sourceType === 'NFS_BLOCK') {
        return 0;
    }
    return 1;
}

interface ClippedOccupant {
    occupant: BudgetOccupant;
    range: MinuteRange;
    /** 입력 순서. 우선순위와 시작 시각이 같을 때 결과를 결정적으로 만든다 */
    inputIndex: number;
}

/**
 * 하루 예산을 계산한다.
 *
 * 처리 순서 (정책 §2 · 데이터모델 §4)
 *   1. 각 점유자를 대상 날짜에 걸친 부분만 잘라낸다 (자정을 넘는 것은 여기서 갈린다)
 *   2. 우선순위 → 시작 시각 → 입력 순서로 정렬한다
 *   3. 앞에서부터 "아직 아무도 안 가져간 자리"만 자기 몫으로 가져간다
 *   4. 가져간 자리를 점유 목록에 더한다
 *
 * 3번이 합집합과 실측 우선을 **동시에** 만든다.
 * 이렇게 하면 태그별 합계의 총합이 점유 합계와 항상 일치한다 — 따로 맞출 필요가 없다.
 */
export function calculateDailyBudget(input: DailyBudgetInput): DailyBudgetResult {
    const minutesPerDay = totalMinutesPerDay();

    // 1. 대상 날짜에 걸친 부분만 남긴다
    const clippedOccupants: ClippedOccupant[] = [];
    let inputIndex = 0;

    for (const occupant of input.occupants) {
        const range = clipRangeToDate(occupant.startTime, occupant.endTime, input.workDate);

        if (range !== null && lengthOfRange(range) > 0) {
            clippedOccupants.push({ occupant: occupant, range: range, inputIndex: inputIndex });
        }
        inputIndex = inputIndex + 1;
    }

    // 2. 정렬 — 실측(NFS)이 먼저 자리를 잡는다
    clippedOccupants.sort(function compareByPriorityThenStart(left, right) {
        const leftPriority = attributionPriorityOf(left.occupant.sourceType);
        const rightPriority = attributionPriorityOf(right.occupant.sourceType);

        if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
        }
        if (left.range.startMinute !== right.range.startMinute) {
            return left.range.startMinute - right.range.startMinute;
        }
        return left.inputIndex - right.inputIndex;
    });

    // 3~4. 앞에서부터 남은 자리만 가져간다
    const claimedRanges: MinuteRange[] = [];
    const attributions: OccupantAttribution[] = [];
    const minutesByTag = new Map<CategoryTag, number>();

    let blockMinutes = 0;
    let calendarMinutes = 0;
    let grossMinutes = 0;

    for (const clipped of clippedOccupants) {
        const ownLength = lengthOfRange(clipped.range);
        grossMinutes = grossMinutes + ownLength;

        // 이미 누가 가져간 자리를 뺀 나머지가 내 몫이다
        const myRanges = subtractMinuteRanges(clipped.range, claimedRanges);
        const myMinutes = grossMinutesOf(myRanges);

        attributions.push({
            referenceKey: clipped.occupant.referenceKey,
            sourceType: clipped.occupant.sourceType,
            categoryTag: clipped.occupant.categoryTag,
            title: clipped.occupant.title,
            grossMinutes: ownLength,
            attributedMinutes: myMinutes,
            overlapDeductedMinutes: ownLength - myMinutes,
        });

        if (myMinutes > 0) {
            const previousTagMinutes = minutesByTag.get(clipped.occupant.categoryTag) ?? 0;
            minutesByTag.set(clipped.occupant.categoryTag, previousTagMinutes + myMinutes);

            if (clipped.occupant.sourceType === 'NFS_BLOCK') {
                blockMinutes = blockMinutes + myMinutes;
            } else {
                calendarMinutes = calendarMinutes + myMinutes;
            }

            // 내가 가져간 자리를 점유 목록에 더한다.
            // 매번 병합해 두면 다음 subtract 가 정렬된 입력을 받는다.
            for (const myRange of myRanges) {
                claimedRanges.push(myRange);
            }
            const remerged = mergeMinuteRanges(claimedRanges);
            claimedRanges.length = 0;
            for (const merged of remerged) {
                claimedRanges.push(merged);
            }
        }
    }

    const occupiedMinutes = blockMinutes + calendarMinutes;

    let remainingMinutes = minutesPerDay - occupiedMinutes;
    let exceededMinutes = 0;
    if (remainingMinutes < 0) {
        exceededMinutes = -remainingMinutes;
        remainingMinutes = 0;
    }

    // 태그 목록은 많이 쓴 순으로 준다. 화면(링·목록)이 그 순서를 쓴다
    const byTag: TagBudget[] = [];
    for (const [categoryTag, minutes] of minutesByTag) {
        byTag.push({ categoryTag: categoryTag, minutes: minutes });
    }
    byTag.sort(function compareByMinutesDescending(left, right) {
        if (left.minutes !== right.minutes) {
            return right.minutes - left.minutes;
        }
        return left.categoryTag.localeCompare(right.categoryTag);
    });

    return {
        workDate: input.workDate,
        totalMinutes: minutesPerDay,
        occupiedMinutes: occupiedMinutes,
        remainingMinutes: remainingMinutes,
        exceededMinutes: exceededMinutes,
        blockMinutes: blockMinutes,
        calendarMinutes: calendarMinutes,
        overlapMinutes: grossMinutes - occupiedMinutes,
        byTag: byTag,
        occupants: attributions,
    };
}

/**
 * 블록을 하나 더 놓았을 때 그날 예산이 얼마나 늘어나는가.
 *
 * ⚠️ **"블록 길이"가 아니다.** 겹치는 자리에 놓으면 실제 증가분은 그보다 적다.
 *    정책 §2.1 규칙 1(배치는 자유)이 성립하려면 이걸 제대로 세야 한다 —
 *    길이로 검사하면 이미 캘린더가 찬 자리에 블록을 못 놓게 되어 규칙 1이 무너진다.
 */
export function marginalMinutesOf(
    existing: DailyBudgetInput,
    candidate: BudgetOccupant,
): number {
    const before = calculateDailyBudget(existing);
    const after = calculateDailyBudget(withCandidate(existing, candidate));

    return after.occupiedMinutes - before.occupiedMinutes;
}

/**
 * 후보 블록을 더한 입력을 만든다. 등록 검증은 이걸로 다시 계산해서 판단한다.
 *
 * 증가분을 따로 구하는 별도 로직을 두지 않는 이유:
 *   그 로직은 결국 계산기와 같은 규칙을 다시 구현하게 된다.
 *   그 순간 "계산기가 두 벌"이 되어 이 파일이 막으려던 버그가 돌아온다.
 *   점유자는 하루 수십 개 수준이라 다시 계산하는 비용은 무시할 만하다.
 */
export function withCandidate(
    input: DailyBudgetInput,
    candidate: BudgetOccupant,
): DailyBudgetInput {
    const occupants: BudgetOccupant[] = [];

    for (const occupant of input.occupants) {
        occupants.push(occupant);
    }
    occupants.push(candidate);

    return { workDate: input.workDate, occupants: occupants };
}

/**
 * 24시간 상한을 넘는지 검사한다. (정책 §2.1 규칙 3)
 *
 * **정확히 1440분은 통과한다.** 하루는 1440분이고 그걸 꽉 채우는 건 초과가 아니다.
 * 막는 것은 1441분부터다.
 *
 * 초과 시 `detail.occupiedBy` 에 점유 내역을 담는다 —
 * 화면이 "무엇이 자리를 차지하는지"를 바로 보여줄 수 있어야 하기 때문이다 (정책 §2.4).
 * 우리는 사용자에게 구글 캘린더를 고치라고 요구하지 않는다.
 */
export function assertWithinDailyCap(result: DailyBudgetResult): void {
    if (result.exceededMinutes === 0) {
        return;
    }

    throw budgetExceeded(result.remainingMinutes, result.exceededMinutes, {
        workDate: result.workDate,
        occupiedMinutes: result.occupiedMinutes,
        exceededMinutes: result.exceededMinutes,
        occupiedBy: result.occupants,
    });
}

/**
 * ⭐ 블록을 새로 등록할 수 있는지 검사한다. (정책 §2.1 규칙 3 · N-026)
 *
 * **기준은 블록의 길이다. 겹침을 뺀 증가분이 아니다.**
 *
 * 왜 증가분이 아닌가:
 *   합집합으로 세면 점유는 절대 1440을 넘을 수 없다 — 겹쳐 놓으면 비용이 0이기 때문이다.
 *   그러면 24시간 상한이 영원히 발화하지 않고, 정책 §2.4(초과 시 화면)가 죽은 코드가 된다.
 *   길이로 검사해야 "남은 4시간"이라는 미터의 숫자와 실제 동작이 일치한다.
 *
 * 규칙 1(배치는 자유)은 유지된다 — 막는 것은 *위치*가 아니라 *총량*이다.
 * 예산이 남아 있는 한 캘린더 일정과 겹치는 자리에도 얼마든지 놓을 수 있다.
 *
 * 자정을 넘는 블록은 그날 몫만 청구된다 (정책 §2.3).
 * 23:00–01:00 블록은 오늘 예산에서 60분만 쓴다 — 나머지 60분은 내일 예산에서 따로 검사한다.
 */
/**
 * 후보가 **그날의 예산에서 실제로 요구하는 분**.
 *
 * 자정을 넘는 블록은 그날에 걸친 부분만 그날 예산을 쓴다.
 * 그날에 아예 안 걸치면 0 이다 — 이 날의 예산과 무관하다는 뜻이다.
 */
function requestedMinutesOf(candidate: BudgetOccupant, workDate: string): number {
    const candidateRange = clipRangeToDate(candidate.startTime, candidate.endTime, workDate);

    if (candidateRange === null) {
        return 0;
    }
    return lengthOfRange(candidateRange);
}

/** 후보를 넣기 전/후를 한 번에 보여준다. 생성 시트(S-05)의 미리보기가 쓴다 */
export interface CandidatePreview {
    /** 후보를 빼고 계산한 현재 예산 */
    before: DailyBudgetResult;
    /** 후보가 그날 예산에서 요구하는 분 */
    requestedMinutes: number;
    /** 만들고 나면 남는 분. **초과하면 음수**다 — 0으로 접으면 얼마나 넘었는지가 사라진다 */
    remainingAfterMinutes: number;
    /** true 면 `assertBlockFitsInBudget` 이 거절한다 */
    isExceeded: boolean;
}

/**
 * ⭐ **화면의 미리보기와 서버의 검증이 같은 판정을 쓰게 만드는 함수.**
 *
 * 생성 시트는 칩을 누를 때마다 이걸 부르고, 서버는 `assertBlockFitsInBudget` 으로 막는다.
 * 둘이 같은 `requestedMinutesOf` 와 같은 비교식을 쓰므로
 * **화면이 "만들 수 있다"고 말한 걸 서버가 거절하는 일이 구조적으로 없다.**
 * (판정을 화면에 한 벌 더 적으면 반드시 언젠가 갈린다)
 */
export function previewWithCandidate(
    input: DailyBudgetInput,
    candidate: BudgetOccupant,
): CandidatePreview {
    const before = calculateDailyBudget(input);
    const requestedMinutes = requestedMinutesOf(candidate, input.workDate);
    const isExceeded = requestedMinutes > before.remainingMinutes;

    let remainingAfterMinutes: number;

    if (isExceeded) {
        remainingAfterMinutes = before.remainingMinutes - requestedMinutes;
    } else {
        // 겹치는 자리는 두 번 세지 않는다. 그래서 단순 뺄셈이 아니라 계산기를 다시 돌린다
        const after = calculateDailyBudget(withCandidate(input, candidate));
        remainingAfterMinutes = after.remainingMinutes;
    }

    return {
        before: before,
        requestedMinutes: requestedMinutes,
        remainingAfterMinutes: remainingAfterMinutes,
        isExceeded: isExceeded,
    };
}

export function assertBlockFitsInBudget(
    existing: DailyBudgetResult,
    candidate: BudgetOccupant,
): void {
    const requestedMinutes = requestedMinutesOf(candidate, existing.workDate);

    if (requestedMinutes <= existing.remainingMinutes) {
        return;
    }

    throw budgetExceeded(existing.remainingMinutes, requestedMinutes, {
        workDate: existing.workDate,
        occupiedMinutes: existing.occupiedMinutes,
        occupiedBy: existing.occupants,
    });
}
