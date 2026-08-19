import { cookies } from 'next/headers';
import {
    buildAuthorizationUrl,
    createOAuthState,
    redirectUriFrom,
} from '@/server/auth/google-oauth';

/**
 * 로그인 시작 — 구글 동의 화면으로 보낸다.
 *
 * JSON 이 아니라 302 를 준다. 브라우저가 링크로 그냥 눌러 들어오는 진입점이기 때문이다.
 * 그래서 withEnvelope 를 쓰지 않는다 — 응답 봉투는 API 용 규약이다.
 */
export async function GET(request: Request): Promise<Response> {
    const state = createOAuthState();
    const redirectUri = redirectUriFrom(request);

    // state 를 쿠키에 넣어두고 콜백에서 대조한다 (로그인 CSRF 방어).
    // 서버 메모리에 두면 서버리스에서 인스턴스가 갈려 대조에 실패한다.
    const cookieStore = await cookies();
    cookieStore.set('nfs_oauth_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 600, // 10분. 동의 화면을 열어둔 채 방치한 흐름은 버린다
    });

    return Response.redirect(buildAuthorizationUrl(redirectUri, state), 302);
}
