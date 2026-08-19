import { cookies } from 'next/headers';
import {
    exchangeCodeForTokens,
    fetchGoogleProfile,
    redirectUriFrom,
} from '@/server/auth/google-oauth';
import { issueSession } from '@/server/auth/session';
import { upsertMemberFromGoogle } from '@/server/services/member';

/**
 * 구글 콜백 — 로그인을 완료하고 화면으로 돌려보낸다.
 *
 * 실패해도 JSON 을 뿌리지 않는다. 사용자는 브라우저로 여기 도착했으므로
 * 오류 코드를 쿼리로 붙여 화면으로 보낸다 — 날것의 JSON 을 보여주지 않는다.
 */
function redirectToApp(request: Request, path: string): Response {
    return Response.redirect(new URL(path, new URL(request.url).origin), 302);
}

export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 사용자가 동의 화면에서 취소한 경우
    const oauthError = url.searchParams.get('error');
    if (oauthError !== null) {
        return redirectToApp(request, '/?login=cancelled');
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    const cookieStore = await cookies();
    const expectedState = cookieStore.get('nfs_oauth_state')?.value;

    // 한 번 쓰면 버린다. 재사용을 막는다
    cookieStore.delete('nfs_oauth_state');

    if (code === null || state === null || expectedState === undefined || state !== expectedState) {
        // 우리가 시작하지 않은 흐름이다. 조용히 로그인 화면으로 돌린다
        return redirectToApp(request, '/?login=invalid_state');
    }

    try {
        const tokens = await exchangeCodeForTokens(code, redirectUriFrom(request));
        const profile = await fetchGoogleProfile(tokens.accessToken);
        const member = await upsertMemberFromGoogle(profile, tokens.refreshToken);

        await issueSession(member.memberId);

        // 처음 온 사람은 온보딩으로. 다음 세션부터는 바로 리포트로 간다
        return redirectToApp(request, member.isNewMember ? '/?welcome=1' : '/');
    } catch (caught) {
        console.error('[nfs] google callback failed', caught);
        return redirectToApp(request, '/?login=failed');
    }
}
