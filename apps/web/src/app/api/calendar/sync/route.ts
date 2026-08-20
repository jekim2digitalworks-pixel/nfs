import { nowInAppZone, toAppLocalString } from '@nfs/domain/time';
import { withMember } from '@/server/http/withMember';
import { syncCurrentWeek } from '@/server/services/calendar-sync';

/**
 * 캘린더 다시 불러오기 (B-11 · 화면정의서 S-03 헤더)
 *
 * **이번 주만 읽는다.** 지난 주는 마감(B-09)이 이미 동결했고,
 * 다음 주는 아직 열리지 않았다 — 그 둘을 여기서 읽으면 정책 §3.2 가 무너진다.
 *
 * ⚠️ 실패해도 **200 으로 상태를 돌려준다.** 토큰 만료(N-028)나 구글 장애는
 *    "요청이 잘못됐다"가 아니라 "지금은 못 읽는다"라서, 화면이 문구를 골라 보여줘야 한다.
 *    500 을 내면 화면은 그냥 "오류"라고만 말하게 된다.
 */
export async function POST(): Promise<Response> {
    return withMember(async function sync(memberId) {
        const now = nowInAppZone();
        const result = await syncCurrentWeek(memberId, now);

        let syncedTime: string | null = null;
        if (result.syncedTime !== null) {
            syncedTime = toAppLocalString(result.syncedTime);
        }

        return {
            status: result.status,
            weekStartDate: result.weekStartDate,
            importedCount: result.importedCount,
            excludedCount: result.excludedCount,
            syncedTime: syncedTime,
        };
    });
}
