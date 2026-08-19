import 'server-only';
import { ZodError } from 'zod';
import { NfsError, isNfsError, type NfsErrorCode } from '@nfs/domain';

/**
 * 응답 규약 (API명세 · 아키텍처 §8)
 *
 * ```json
 * { "success": true,  "data": { ... } }
 * { "success": false, "error": { "code", "message", "detail" } }
 * ```
 *
 * ⭐ **핸들러가 이 봉투를 손으로 감싸지 않는다.** 한 곳에서만 만든다 —
 *    직접 쓰기 시작하면 언젠가 한 군데가 빠지고, 그 엔드포인트만 프론트에서 깨진다.
 */

/** 도메인 에러 코드 → HTTP 상태. 아키텍처 §8 의 표가 단일 원천이다 */
const HTTP_STATUS_BY_CODE: Record<NfsErrorCode, number> = {
    BUDGET_EXCEEDED: 400,
    INVALID_BLOCK_LENGTH: 400,
    CATEGORY_REQUIRED: 400,
    ILLEGAL_BLOCK_STATE: 409,
    ALREADY_SETTLED: 409,
    CALENDAR_SYNC_FAILED: 502,
    WEEK_ALREADY_CLOSED: 409,
};

/** 인증 실패는 도메인 에러가 아니다 — HTTP 계층의 사정이다 */
export const UNAUTHORIZED_CODE = 'UNAUTHORIZED';
/** 입력이 규약을 벗어났다. 도메인까지 가기 전에 막는다 */
export const INVALID_REQUEST_CODE = 'INVALID_REQUEST';

export function ok<T>(data: T, status = 200): Response {
    return Response.json({ success: true, data: data }, { status: status });
}

export function fail(
    code: string,
    message: string,
    status: number,
    detail?: Record<string, unknown>,
): Response {
    const error: Record<string, unknown> = { code: code, message: message };

    if (detail !== undefined) {
        error['detail'] = detail;
    }
    return Response.json({ success: false, error: error }, { status: status });
}

/**
 * 잡힌 예외를 응답으로 바꾼다.
 *
 * 세 갈래뿐이다:
 *   1. Zod 검증 실패 → 400. 어느 필드가 왜 틀렸는지 함께 준다
 *   2. 도메인 예외   → 표대로 매핑. message 는 사용자에게 그대로 보여줄 한국어다
 *   3. 그 외         → 500. **내부 메시지를 밖으로 내보내지 않는다**
 */
export function toErrorResponse(caught: unknown): Response {
    if (caught instanceof ZodError) {
        // 어느 필드가 틀렸는지 알려준다. 프론트가 그 자리에 표시할 수 있어야 한다.
        const fieldErrors: Record<string, string> = {};
        for (const issue of caught.issues) {
            const path = issue.path.join('.');
            fieldErrors[path.length > 0 ? path : '_'] = issue.message;
        }

        return fail(INVALID_REQUEST_CODE, '입력값을 확인해주세요', 400, { fields: fieldErrors });
    }

    if (isNfsError(caught)) {
        const status = HTTP_STATUS_BY_CODE[caught.code] ?? 400;
        return fail(caught.code, caught.message, status, caught.detail);
    }

    // 예상 못 한 예외. 스택이나 DB 오류 문구가 사용자에게 나가면 안 된다.
    // 원인은 서버 로그에만 남긴다.
    console.error('[nfs] unhandled error', caught);

    return fail('INTERNAL_ERROR', '잠시 후 다시 시도해주세요', 500);
}

/** 도메인 예외를 HTTP 계층에서 만들 일이 있을 때 쓴다 (드물어야 정상이다) */
export function domainError(
    code: NfsErrorCode,
    message: string,
    detail?: Record<string, unknown>,
): NfsError {
    return new NfsError(code, message, detail);
}
