import type { DateTime } from 'luxon';
import {
    BLOCK_MINUTES_MAX,
    BLOCK_MINUTES_MIN,
    BLOCK_MINUTES_UNIT,
} from '../types/block';
import { NfsError, invalidBlockLength } from '../errors';

/**
 * 블록 생성 규칙 검증 (정책 §1.1)
 *
 * 검증 순서가 정해져 있다 (API명세 §2):
 *   태그 필수 → 길이 → 격자 정렬 → 예산 초과
 *
 * 왜 순서가 중요한가:
 *   사용자에게 한 번에 하나의 문제만 보여주기 위해서다.
 *   "태그도 없고 길이도 틀렸고 예산도 넘었다"는 메시지는 무엇부터 고쳐야 할지 알려주지 않는다.
 *   가장 싸게 고칠 수 있는 것부터 잡는다.
 */

/** 태그가 없으면 원장에 기록될 수 없다. 그래서 생성 자체를 막는다 (정책 §1.1) */
export function assertCategoryTagPresent(categoryTag: string | null | undefined): void {
    if (categoryTag !== null && categoryTag !== undefined && categoryTag.length > 0) {
        return;
    }
    throw new NfsError('CATEGORY_REQUIRED', '카테고리를 골라주세요');
}

/**
 * 길이는 30분 배수, 30~180분. (정책 §1.1)
 *
 * 상한 180분은 "3시간 뷰"에서 온다. 하루를 통째로 계획하는 피로를 없애는 게 제품의 전제라,
 * 한 블록이 3시간을 넘으면 그 전제가 무너진다.
 */
export function assertValidBlockLength(plannedMinutes: number): void {
    if (!Number.isInteger(plannedMinutes)) {
        throw invalidBlockLength(plannedMinutes);
    }
    if (plannedMinutes % BLOCK_MINUTES_UNIT !== 0) {
        throw invalidBlockLength(plannedMinutes);
    }
    if (plannedMinutes < BLOCK_MINUTES_MIN || plannedMinutes > BLOCK_MINUTES_MAX) {
        throw invalidBlockLength(plannedMinutes);
    }
}

/**
 * 시작 시각은 30분 격자(`:00` 또는 `:30`)에 정렬한다. (정책 §1.1)
 *
 * 격자를 강제하는 이유는 화면 때문이 아니라 **겹침 계산 때문**이다.
 * 14:07 같은 시작을 허용하면 타임라인이 어긋나 보이고,
 * 사용자가 "왜 5분이 비었지"를 계속 묻게 된다.
 */
export function assertAlignedToGrid(plannedStartTime: DateTime): void {
    const isAligned =
        plannedStartTime.minute % BLOCK_MINUTES_UNIT === 0 &&
        plannedStartTime.second === 0 &&
        plannedStartTime.millisecond === 0;

    if (isAligned) {
        return;
    }
    throw new NfsError('INVALID_BLOCK_LENGTH', '블록은 정시 또는 30분에 시작합니다', {
        plannedStartTime: plannedStartTime.toISO(),
    });
}

/**
 * 30분 블록은 뽀모도로 1사이클(집중 25 + 휴식 5)과 정확히 맞는다. (정책 §1.4)
 *
 * 이 값은 화면이 "3사이클" 같은 안내를 그릴 때 쓴다.
 * **집중 시간 계산에는 쓰지 않는다** — 휴식을 실제로 쉬었는지는 타이머만 안다.
 * 휴식 구간은 PAUSED 로 들어가므로 누적 집중 초에 자연히 포함되지 않는다 (N-019).
 */
export function pomodoroCyclesOf(plannedMinutes: number): number {
    return Math.floor(plannedMinutes / BLOCK_MINUTES_UNIT);
}
