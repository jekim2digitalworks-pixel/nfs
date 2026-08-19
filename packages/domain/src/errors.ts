/**
 * 도메인 예외 — 에러 코드 표는 docs/개발/01-아키텍처.md §8 이 단일 원천이다.
 *
 * 왜 도메인에 두는가:
 *   "예산을 넘었다"는 판단은 계산기가 한다. HTTP 계층은 그 판단을 옮겨 적을 뿐이다.
 *   에러를 서비스에서 만들면 같은 판단이 API와 배치 두 군데에 생기고,
 *   언젠가 한쪽만 고쳐진다.
 *
 * HTTP 상태 매핑은 여기서 하지 않는다. 도메인은 HTTP를 모른다.
 * 매핑은 apps/web/src/server/http/ 한 곳에서 한다.
 */

export const NFS_ERROR_CODES = [
    'BUDGET_EXCEEDED',
    'INVALID_BLOCK_LENGTH',
    'CATEGORY_REQUIRED',
    'ILLEGAL_BLOCK_STATE',
    'ALREADY_SETTLED',
    'CALENDAR_SYNC_FAILED',
    'WEEK_ALREADY_CLOSED',
] as const;

export type NfsErrorCode = (typeof NFS_ERROR_CODES)[number];

/**
 * message는 사용자에게 그대로 보여줄 수 있는 한국어로 쓴다.
 * 프론트에서 코드별 문구를 다시 만들지 않게 하기 위한 규약이다.
 */
export class NfsError extends Error {
    readonly code: NfsErrorCode;
    readonly detail: Record<string, unknown> | undefined;

    constructor(code: NfsErrorCode, message: string, detail?: Record<string, unknown>) {
        super(message);
        // Error를 상속할 때 프로토타입 체인이 끊기는 걸 되돌린다.
        // 이게 없으면 instanceof NfsError 가 false가 되어 예외 필터가 못 잡는다.
        Object.setPrototypeOf(this, new.target.prototype);

        this.name = 'NfsError';
        this.code = code;
        this.detail = detail;
    }
}

export function isNfsError(candidate: unknown): candidate is NfsError {
    return candidate instanceof NfsError;
}

/**
 * 자주 쓰는 예외는 생성자를 따로 둔다.
 * 호출부마다 한국어 문구를 새로 쓰면 같은 상황에 다른 말이 나온다.
 */
export function budgetExceeded(
    remainingMinutes: number,
    requestedMinutes: number,
    detail?: Record<string, unknown>,
): NfsError {
    // 남은 시간을 시간 단위로 말한다. "남은 247분"은 사람이 읽고 판단하기 어렵다.
    const remainingHours = Math.floor(remainingMinutes / 60);

    let message: string;
    if (remainingHours > 0) {
        message = `오늘 남은 ${remainingHours}시간을 넘습니다`;
    } else {
        message = '오늘은 더 넣을 자리가 없습니다';
    }

    return new NfsError('BUDGET_EXCEEDED', message, {
        remainingMinutes: remainingMinutes,
        requestedMinutes: requestedMinutes,
        ...detail,
    });
}

export function invalidBlockLength(requestedMinutes: number): NfsError {
    return new NfsError(
        'INVALID_BLOCK_LENGTH',
        '블록은 30분 단위로 30분부터 3시간까지 만들 수 있습니다',
        { requestedMinutes: requestedMinutes },
    );
}

export function illegalBlockState(currentStatus: string, attemptedStatus: string): NfsError {
    return new NfsError('ILLEGAL_BLOCK_STATE', '지금은 그 동작을 할 수 없습니다', {
        currentStatus: currentStatus,
        attemptedStatus: attemptedStatus,
    });
}

export function weekAlreadyClosed(weekStartDate: string): NfsError {
    return new NfsError('WEEK_ALREADY_CLOSED', '마감된 주는 수정할 수 없습니다', {
        weekStartDate: weekStartDate,
    });
}
