import { withMember } from '@/server/http/withMember';
import { findMemberSummary } from '@/server/services/member';

/** 로그인한 회원 정보. 화면 상단과 설정이 쓴다 */
export async function GET(): Promise<Response> {
    return withMember(async function loadMe(memberId) {
        return await findMemberSummary(memberId);
    });
}
