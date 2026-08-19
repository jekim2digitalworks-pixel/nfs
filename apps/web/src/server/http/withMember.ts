import 'server-only';
import { currentMemberId } from '../auth/session';
import { UNAUTHORIZED_CODE, fail, ok, toErrorResponse } from './response';

/**
 * ⭐ 모든 인증 API 의 고정 모양 (아키텍처 §3.1)
 *
 * 이 래퍼가 세 가지를 한 곳에서 처리한다:
 *   1. 세션 확인 — 없으면 401
 *   2. 결과를 `{ success: true, data }` 로 감싸기
 *   3. 예외를 코드·상태로 매핑
 *
 * NestJS 를 버리면서 가드·인터셉터·예외필터가 사라졌다 (N-023).
 * 프레임워크가 강제해주지 않으므로 **모양을 규약으로 고정한다.**
 *
 * ```ts
 * export async function POST(request: Request): Promise<Response> {
 *     return withMember(async (memberId) => {
 *         const command = CreateBlockSchema.parse(await request.json());
 *         return await blockService.createBlock(memberId, command);
 *     });
 * }
 * ```
 *
 * ⚠️ 핸들러는 **DTO 를 그냥 반환한다.** `ok()` 를 직접 부르지 않는다 —
 *    직접 부르기 시작하면 언젠가 한 군데가 빠지고 그 엔드포인트만 프론트에서 깨진다.
 */
export async function withMember<T>(
    handler: (memberId: bigint) => Promise<T>,
    options: { status?: number } = {},
): Promise<Response> {
    let memberId: bigint | null;

    try {
        memberId = await currentMemberId();
    } catch (caught) {
        return toErrorResponse(caught);
    }

    if (memberId === null) {
        return fail(UNAUTHORIZED_CODE, '로그인이 필요합니다', 401);
    }

    try {
        const data = await handler(memberId);
        return ok(serializeForJson(data), options.status ?? 200);
    } catch (caught) {
        return toErrorResponse(caught);
    }
}

/**
 * 세션 없이도 되는 엔드포인트용. 봉투와 예외 매핑만 해준다.
 * (구글 콜백·헬스체크처럼 로그인 전에 도는 것들)
 */
export async function withEnvelope<T>(
    handler: () => Promise<T>,
    options: { status?: number } = {},
): Promise<Response> {
    try {
        const data = await handler();
        return ok(serializeForJson(data), options.status ?? 200);
    } catch (caught) {
        return toErrorResponse(caught);
    }
}

/**
 * 배치 엔드포인트 가드 (아키텍처 §5.1)
 *
 * GitHub Actions 크론만 부른다. 세션이 아니라 공유 시크릿으로 인증한다.
 *
 * ⭐ **시크릿이 틀리면 401 이 아니라 404 를 준다.**
 *    공개 URL 이므로 401 을 주면 "여기 정산 엔드포인트가 있다"는 사실을 알려주는 셈이다.
 *    존재 자체를 숨긴다.
 */
export async function withCronSecret<T>(
    request: Request,
    handler: () => Promise<T>,
): Promise<Response> {
    const expected = process.env['CRON_SECRET'];
    const provided = request.headers.get('x-cron-secret');

    if (expected === undefined || expected.length === 0) {
        // 시크릿을 설정하지 않은 채 배포하면 엔드포인트가 무방비로 열린다.
        // 그럴 바엔 닫아둔다.
        console.error('[nfs] CRON_SECRET 이 설정되지 않았습니다');
        return new Response(null, { status: 404 });
    }

    if (provided !== expected) {
        return new Response(null, { status: 404 });
    }

    return withEnvelope(handler);
}

/**
 * JSON 으로 내보낼 수 있는 형태로 바꾼다.
 *
 * ⚠️ **BigInt 는 JSON.stringify 에서 그냥 터진다** (TypeError).
 *    Prisma 의 PK 와 `SUM()` 결과가 전부 BigInt 라 이 사고는 반드시 한 번은 난다.
 *    id 를 문자열로 내보내는 이유는 정밀도 때문이기도 하다 —
 *    JS number 는 2^53 을 넘는 정수를 정확히 담지 못한다.
 *
 * DTO 를 만들 때 미리 변환하는 게 원칙이지만, 한 군데라도 빠지면 500 이 난다.
 * 마지막 그물을 여기 둔다.
 */
function serializeForJson(value: unknown): unknown {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (Array.isArray(value)) {
        const converted: unknown[] = [];
        for (const item of value) {
            converted.push(serializeForJson(item));
        }
        return converted;
    }
    if (value !== null && typeof value === 'object') {
        // Date · Luxon DateTime 등은 자기 toJSON 을 갖고 있으므로 건드리지 않는다
        if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
            return value;
        }
        const converted: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            converted[key] = serializeForJson(item);
        }
        return converted;
    }
    return value;
}
