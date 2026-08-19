import { nowInAppZone } from '@nfs/domain/time';
import { withMember } from '@/server/http/withMember';
import { findCurrentBlock } from '@/server/services/block';

/** 진행 중인 블록 + 서버 기준 시각. 클라 타이머가 이 값으로 재동기화한다 */
export async function GET(): Promise<Response> {
    return withMember(async function current(memberId) {
        const now = nowInAppZone();
        const block = await findCurrentBlock(memberId, now);

        // 블록이 없어도 serverTime 은 준다 — 타이머가 오프셋을 유지할 수 있어야 한다
        if (block === null) {
            return { block: null, serverTime: now.toFormat("yyyy-MM-dd'T'HH:mm:ss") };
        }
        return { block: block, serverTime: block.serverTime };
    });
}
