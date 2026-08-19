import { z } from 'zod';
import { NfsError } from '@nfs/domain';
import { nowInAppZone } from '@nfs/domain/time';
import { withMember } from '@/server/http/withMember';
import { completeBlock, pauseBlock, resumeBlock, startBlock } from '@/server/services/block';

/**
 * 블록 상태 전이 (API명세 §2)
 *
 * 네 동작이 모양이 같아 한 파일로 묶었다.
 * 파일을 넷으로 나누면 `withMember` 래핑과 파라미터 파싱이 네 벌이 되고,
 * 한 곳만 고쳐지는 사고가 난다.
 */
const ActionSchema = z.enum(['start', 'pause', 'resume', 'complete', 'abandon']);
const BlockIdSchema = z.string().regex(/^\d+$/);

export async function POST(
    _request: Request,
    // ⚠️ Next 16 에서 params 는 Promise 다 (N-024)
    context: { params: Promise<{ blockId: string; action: string }> },
): Promise<Response> {
    return withMember(async function transition(memberId) {
        const params = await context.params;
        const action = ActionSchema.parse(params.action);
        const blockId = BigInt(BlockIdSchema.parse(params.blockId));
        const now = nowInAppZone();

        if (action === 'start') {
            return await requireFound(await startBlock(memberId, blockId, now));
        }
        if (action === 'pause') {
            return await requireFound(await pauseBlock(memberId, blockId, now));
        }
        if (action === 'resume') {
            return await requireFound(await resumeBlock(memberId, blockId, now));
        }

        // 완료·포기는 곧 정산이다. 이미 정산된 블록이면 조용히 성공으로 끝낸다 —
        // 더블 탭·재시도가 오류로 보이면 안 된다 (테스트계획 #16)
        const trigger = action === 'complete' ? 'USER_COMPLETE' : 'USER_ABANDON';
        const result = await completeBlock(memberId, blockId, now, trigger);

        if (result === null) {
            return { settled: false, alreadyGone: true };
        }
        return {
            settled: true,
            inserted: result.inserted,
            completionType: result.draft.completionType,
            actualFocusMinutes: result.draft.actualFocusMinutes,
            overlapDeductedMinutes: result.overlapDeductedMinutes,
            statDate: result.draft.statDate,
        };
    });
}

async function requireFound<T>(value: T | null): Promise<T> {
    if (value === null) {
        throw new NfsError('ILLEGAL_BLOCK_STATE', '블록을 찾을 수 없습니다');
    }
    return value;
}
