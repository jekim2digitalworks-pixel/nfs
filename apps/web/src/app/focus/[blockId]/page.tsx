import { redirect } from 'next/navigation';
import { nowInAppZone, workDateOf } from '@nfs/domain/time';
import { currentMemberId } from '@/server/auth/session';
import { findBlockOfMember, loadDayBudget } from '@/server/services/block';
import { FocusStage, type FocusBlockView } from '@/components/focus/FocusStage';

/**
 * S-04 집중 (U-05)
 *
 * 서버 컴포넌트가 **첫 사진**을 찍어 넘긴다 — 블록 상태와 그 시점의 서버 시각.
 * 그 뒤로 흐르는 건 클라이언트가 표시만 하고, 판정은 다시 서버가 한다.
 *
 * ⭐ 경계를 잎사귀 쪽으로 민다 (퍼블 §3.4). 타이머 하나 때문에
 *   화면 전체가 클라이언트가 될 이유는 없다 — 데이터는 여기서 서버가 읽는다.
 */

export default async function FocusBlockPage({
    // ⚠️ Next 16 에서 params 는 Promise 다 (N-024)
    params,
}: {
    params: Promise<{ blockId: string }>;
}) {
    const memberId = await currentMemberId();

    if (memberId === null) {
        redirect('/day');
    }

    const { blockId } = await params;

    if (!/^\d+$/.test(blockId)) {
        redirect('/day');
    }

    const now = nowInAppZone();
    const block = await findBlockOfMember(memberId, BigInt(blockId), now);

    // 이미 완료·정산된 블록이다. 집중할 대상이 없으므로 하루로 돌려보낸다
    if (block === null) {
        redirect('/day');
    }

    const budget = await loadDayBudget(memberId, workDateOf(now));

    return (
        <>
            {/* 집중 화면의 광원은 다이얼 뒤의 **카테고리 색**이다 (디자인 §2.4) */}
            <div className="focus-bloom" data-tag={block.categoryTag} />
            <div className="focus-grain" />

            <div className="screen screen-focus">
                <FocusStage
                    block={block as FocusBlockView}
                    remainingBudgetMinutes={budget.remainingMinutes}
                />
            </div>
        </>
    );
}
