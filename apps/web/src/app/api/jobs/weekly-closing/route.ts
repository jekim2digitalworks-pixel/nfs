import { nowInAppZone } from '@nfs/domain/time';
import { withCronSecret } from '@/server/http/withMember';
import { runWeeklyClosing } from '@/server/services/closing';

/**
 * 주간 마감 배치 (O-07 · B-09 · API명세 §6)
 *
 * GitHub Actions 크론이 **UTC 일요일 19:00 = KST 월요일 04:00** 에 부른다.
 * 요일이 다르다는 게 이 엔드포인트에서 가장 자주 틀리는 부분이다.
 *
 * 한 주가 끝나면 그 주의 캘린더 데이터를 원장으로 옮기고 동결한다.
 * **되돌릴 수 없다** — 재개봉은 정책에 없다 (정책 §3.3).
 * 그래서 대상 판정을 "지난주"가 아니라 `isWeekClosable`(기한 초과)로 한다.
 */

/** 자정 정산과 같은 이유. 회원이 늘면 hasMore 로 나눠 받는다 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
    return withCronSecret(request, async function runBatch() {
        const now = nowInAppZone();
        const summary = await runWeeklyClosing(now);

        console.info('[nfs] weekly closing', JSON.stringify(summary));

        return summary;
    });
}
