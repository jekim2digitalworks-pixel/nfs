import { clearSession } from '@/server/auth/session';
import { withEnvelope } from '@/server/http/withMember';

/**
 * 로그아웃 — 세션 쿠키만 지운다.
 *
 * 구글 리프레시 토큰은 **지우지 않는다.** 로그아웃은 "이 브라우저에서 나간다"는 뜻이고,
 * 연동 해제와 다르다. 토큰 파기는 설정의 「연동 해제」가 한다 (정책 §7).
 */
export async function POST(): Promise<Response> {
    return withEnvelope(async function logout() {
        await clearSession();
        return { loggedOut: true };
    });
}
