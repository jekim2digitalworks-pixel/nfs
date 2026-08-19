import 'server-only';
import { randomBytes } from 'node:crypto';

/**
 * 구글 OAuth — 로그인과 캘린더 읽기가 이 하나를 같이 쓴다 (N-014).
 *
 * 라이브러리(googleapis 등)를 쓰지 않는 이유:
 *   우리가 쓰는 건 authorization code 흐름 하나뿐이고, 엔드포인트 두 개를 fetch 하면 끝난다.
 *   구글 SDK 는 수십 MB 에 서버리스 콜드스타트를 늘린다.
 *   무엇을 보내고 무엇을 신뢰하는지가 코드에 그대로 보이는 편이 낫다.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * 읽기 전용 스코프로 시작한다 (N-014).
 * 쓰기 권한은 가입 퍼널을 누르므로 Phase 2 에서 증분 요청한다.
 */
const SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar.readonly',
];

export interface GoogleTokens {
    accessToken: string;
    /** ⚠️ 첫 동의 때만 온다. 재로그인 시에는 없을 수 있다 */
    refreshToken: string | null;
    expiresInSeconds: number;
}

export interface GoogleProfile {
    googleUserId: string;
    email: string;
    displayName: string;
}

function requiredEnv(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.length === 0) {
        throw new Error(`${name} 이 없습니다. .env.local 또는 Vercel 환경변수를 확인하세요.`);
    }
    return value;
}

/**
 * 콜백이 돌아올 주소.
 *
 * 요청의 Origin 에서 만든다 — localhost 와 배포본을 각각 하드코딩하면
 * Vercel 프리뷰 도메인에서 매번 깨진다.
 * ⚠️ 여기서 만든 값이 구글 콘솔의 **승인된 리디렉션 URI** 와 한 글자도 다르면
 *    `redirect_uri_mismatch` 가 난다.
 */
export function redirectUriFrom(request: Request): string {
    const origin = new URL(request.url).origin;
    return `${origin}/api/auth/google/callback`;
}

/**
 * CSRF 방어용 state.
 *
 * 공격자가 자기 계정의 콜백 URL 을 피해자에게 열게 하면 피해자 세션이
 * 공격자 계정에 묶인다(로그인 CSRF). 우리가 발급한 state 인지 확인해 막는다.
 */
export function createOAuthState(): string {
    return randomBytes(24).toString('base64url');
}

export function buildAuthorizationUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
        client_id: requiredEnv('GOOGLE_CLIENT_ID'),
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state: state,

        // ⭐ 이 둘이 있어야 리프레시 토큰이 온다.
        // 배치(자정 정산·주간 마감)가 사용자 없이 캘린더를 읽으려면 반드시 필요하다 (N-021).
        access_type: 'offline',

        // 이미 동의한 사용자에게도 동의 화면을 다시 띄운다.
        // 없으면 재로그인 시 refresh_token 이 오지 않아, 토큰을 잃은 사용자가 복구할 방법이 없어진다.
        prompt: 'consent',
    });

    return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** authorization code 를 토큰으로 바꾼다 */
export async function exchangeCodeForTokens(
    code: string,
    redirectUri: string,
): Promise<GoogleTokens> {
    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code: code,
            client_id: requiredEnv('GOOGLE_CLIENT_ID'),
            client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) {
        // 구글의 오류 본문에는 client_id 가 섞여 나온다. 로그에만 남기고 밖으로 내보내지 않는다.
        const detail = await response.text();
        console.error('[nfs] google token exchange failed', response.status, detail);
        throw new Error('구글 토큰 교환 실패');
    }

    const body = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
    };

    return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        expiresInSeconds: body.expires_in,
    };
}

/** 액세스 토큰으로 누구인지 확인한다 */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
    const response = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        console.error('[nfs] google userinfo failed', response.status);
        throw new Error('구글 사용자 정보 조회 실패');
    }

    const body = (await response.json()) as { id: string; email: string; name?: string };

    // 이름을 안 주는 계정이 있다. 이메일 앞부분으로 대신한다 —
    // 화면에 빈 이름이 나오면 그 자체로 버그처럼 보인다.
    let displayName = body.name ?? '';
    if (displayName.length === 0) {
        displayName = body.email.split('@')[0] ?? '사용자';
    }

    return {
        googleUserId: body.id,
        email: body.email,
        displayName: displayName,
    };
}
