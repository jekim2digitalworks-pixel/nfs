/**
 * 클라이언트 API 레이어 (F-02 · 퍼블 §4.1)
 *
 * 서버는 응답 모양이 **하나로 고정**돼 있다 (아키텍처 §8).
 *
 * ```json
 * { "success": true,  "data": { … } }
 * { "success": false, "error": { "code", "message", "detail" } }
 * ```
 *
 * 그런데 화면마다 `fetch` 하고 봉투를 벗기면 **벗기는 방법이 화면 수만큼 생긴다.**
 * 실제로 생성 시트와 집중 화면에 같은 코드가 두 벌 복사돼 있었다 —
 * 세 번째가 생기기 전에 한 곳으로 모은다.
 *
 * ⭐ **예외를 던지지 않고 결과를 돌려준다.** 네트워크 실패와 도메인 거절(예산 초과)은
 *   둘 다 "정상적으로 일어나는 일"이라 try/catch 로 흐름을 끊을 이유가 없다.
 *   화면은 `result.ok` 하나만 보면 된다.
 */

export interface ApiFailure {
    ok: false;
    /** 도메인 에러 코드. 네트워크·서버 오류면 null */
    code: string | null;
    /** ⭐ 사용자에게 그대로 보여줄 한국어. 서버가 이미 그렇게 만들어 보낸다 */
    message: string;
    /** `BUDGET_EXCEEDED` 의 점유 내역처럼 코드별 부가 정보 */
    detail: Record<string, unknown> | null;
}

export interface ApiSuccess<T> {
    ok: true;
    data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const NETWORK_MESSAGE = '네트워크가 불안정합니다. 다시 시도해 주세요';
const UNKNOWN_MESSAGE = '요청을 처리하지 못했습니다';

/**
 * 봉투에서 오류를 꺼낸다.
 *
 * 한 단계씩 확인하는 이유: 봉투가 깨진 응답(프록시가 끼워 넣은 HTML, 502 페이지)에서
 * `payload.error.message` 를 바로 읽으면 **화면이 통째로 죽는다.**
 * 서버가 정상일 때만 동작하는 코드를 오류 처리 경로에 두지 않는다.
 */
function toFailure(payload: unknown): ApiFailure {
    const failure: ApiFailure = { ok: false, code: null, message: UNKNOWN_MESSAGE, detail: null };

    if (payload === null || typeof payload !== 'object') {
        return failure;
    }
    if (!('error' in payload)) {
        return failure;
    }

    const error = payload.error;
    if (error === null || typeof error !== 'object') {
        return failure;
    }

    if ('message' in error && typeof error.message === 'string') {
        failure.message = error.message;
    }
    if ('code' in error && typeof error.code === 'string') {
        failure.code = error.code;
    }
    if ('detail' in error && error.detail !== null && typeof error.detail === 'object') {
        failure.detail = error.detail as Record<string, unknown>;
    }
    return failure;
}

async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    let response: Response;

    try {
        response = await fetch(path, init);
    } catch {
        // 오프라인·타임아웃. 서버는 이 사실을 모르므로 문구도 여기서 만든다
        return { ok: false, code: null, message: NETWORK_MESSAGE, detail: null };
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        return { ok: false, code: null, message: UNKNOWN_MESSAGE, detail: null };
    }

    if (!response.ok) {
        return toFailure(payload);
    }

    if (payload !== null && typeof payload === 'object' && 'success' in payload) {
        if (payload.success === true && 'data' in payload) {
            return { ok: true, data: payload.data as T };
        }
    }
    return toFailure(payload);
}

export async function getJson<T>(path: string): Promise<ApiResult<T>> {
    return await request<T>(path, { method: 'GET' });
}

export async function postJson<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    const init: RequestInit = { method: 'POST' };

    if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(body);
    }
    return await request<T>(path, init);
}
