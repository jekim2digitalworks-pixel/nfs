import { redirect } from 'next/navigation';
import { nowInAppZone } from '@nfs/domain/time';
import { currentMemberId } from '@/server/auth/session';
import { findCurrentBlock } from '@/server/services/block';

/**
 * 집중 탭의 진입점 — 화면이 아니라 **분기**다 (화면정의서 §1).
 *
 *   진행 중인 블록이 있으면  → S-04 (`/focus/{blockId}`)
 *   없으면                   → S-03 하루 (거기 FAB 이 블록 생성 시트를 연다)
 *
 * 빈 집중 화면을 보여주지 않는 이유: 집중할 대상이 없는데 타이머를 띄우면
 * 사용자가 "무엇을" 시작하는지 모른 채 버튼을 누르게 된다.
 */
export default async function FocusEntryPage() {
    const memberId = await currentMemberId();

    if (memberId === null) {
        redirect('/day');
    }

    const current = await findCurrentBlock(memberId, nowInAppZone());

    if (current === null) {
        redirect('/day?new=1');
    }
    redirect(`/focus/${current.activeBlockId}`);
}
