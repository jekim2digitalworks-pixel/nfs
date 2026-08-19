import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { nowInAppZone } from '@nfs/domain/time';

/**
 * 세션 — httpOnly 쿠키에 서명된 회원 식별자를 담는다.
 *
 * 왜 JWT 라이브러리를 쓰지 않나:
 *   담을 게 회원 id 와 만료 시각 둘뿐이다. 서버가 직접 발급하고 직접 검증하며
 *   제3자에게 넘기지도 않는다. JWT 의 이점(자기기술적 클레임·표준 검증)이 필요 없고,
 *   알고리즘 혼동(alg:none) 같은 함정만 따라온다.
 *   HMAC 서명 한 줄이면 충분하고, 무엇을 신뢰하는지가 코드에 그대로 보인다.
 *
 * ⚠️ 구글 리프레시 토큰은 **여기 담지 않는다.** DB 에 암호화해서 둔다 —
 *    브라우저로 내려보내면 배치가 쓸 수도 없고 유출 면적만 넓어진다 (N-021).
 */

const COOKIE_NAME = 'nfs_session';
const SESSION_DAYS = 30;

interface SessionPayload {
    memberId: bigint;
    expiresAtEpochSeconds: number;
}

function sessionSecret(): string {
    const secret = process.env['SESSION_SECRET'];

    if (secret === undefined || secret.length < 16) {
        throw new Error('SESSION_SECRET 이 없거나 너무 짧습니다 (32바이트 이상 권장).');
    }
    return secret;
}

function signatureOf(body: string): string {
    return createHmac('sha256', sessionSecret()).update(body).digest('base64url');
}

/**
 * 서명 비교는 **timingSafeEqual** 로 한다.
 *
 * `===` 는 첫 다른 글자에서 즉시 끝나므로, 응답 시간 차이로 서명을 한 글자씩
 * 맞춰갈 수 있다. 실전에서 뚫기 쉽진 않지만 비용이 0인 방어를 굳이 버릴 이유가 없다.
 */
function signatureMatches(expected: string, provided: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);

    if (expectedBuffer.length !== providedBuffer.length) {
        return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
}

function encodeSession(payload: SessionPayload): string {
    const body = `${payload.memberId.toString()}.${payload.expiresAtEpochSeconds}`;
    return `${body}.${signatureOf(body)}`;
}

function decodeSession(raw: string): SessionPayload | null {
    const parts = raw.split('.');
    if (parts.length !== 3) {
        return null;
    }

    const [memberIdText, expiresText, providedSignature] = parts as [string, string, string];
    const body = `${memberIdText}.${expiresText}`;

    if (!signatureMatches(signatureOf(body), providedSignature)) {
        return null;
    }

    const expiresAtEpochSeconds = Number(expiresText);
    if (!Number.isFinite(expiresAtEpochSeconds)) {
        return null;
    }

    // 만료 검사는 서명 검사 **다음**이다. 순서를 바꾸면 위조된 만료 시각을 믿게 된다.
    if (expiresAtEpochSeconds <= Math.floor(nowInAppZone().toSeconds())) {
        return null;
    }

    let memberId: bigint;
    try {
        memberId = BigInt(memberIdText);
    } catch {
        return null;
    }

    return { memberId: memberId, expiresAtEpochSeconds: expiresAtEpochSeconds };
}

/**
 * 요청의 세션에서 회원 id 를 꺼낸다. 없거나 위조됐으면 null.
 *
 * ⚠️ Next 16 에서 `cookies()` 는 **비동기다.** 동기 접근은 완전히 제거됐다 (N-024).
 */
export async function currentMemberId(): Promise<bigint | null> {
    const cookieStore = await cookies();
    const raw = cookieStore.get(COOKIE_NAME)?.value;

    if (raw === undefined) {
        return null;
    }

    const payload = decodeSession(raw);
    if (payload === null) {
        return null;
    }
    return payload.memberId;
}

/** 로그인 성공 시 세션을 발급한다 (B-03 에서 구글 콜백이 호출한다) */
export async function issueSession(memberId: bigint): Promise<void> {
    const expiresAt = nowInAppZone().plus({ days: SESSION_DAYS });
    const cookieStore = await cookies();

    cookieStore.set(COOKIE_NAME, encodeSession({
        memberId: memberId,
        expiresAtEpochSeconds: Math.floor(expiresAt.toSeconds()),
    }), {
        httpOnly: true, // 스크립트가 읽지 못한다. XSS 가 나도 세션은 새지 않는다
        sameSite: 'lax', // 외부 사이트의 POST 를 막는다. 다만 이것만 믿지 않는다 (CSRF 토큰 별도)
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: expiresAt.toJSDate(),
    });
}

/** 로그아웃 */
export async function clearSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
}
