import { nowInAppZone } from '@nfs/domain/time';
import { withCronSecret } from '@/server/http/withMember';
import { runDailySettlement } from '@/server/services/settlement';

/**
 * 자정 정산 배치 (O-07 · B-08 · API명세 §6)
 *
 * GitHub Actions 크론이 **UTC 15:05 = KST 00:05** 에 부른다.
 * 어제까지의 `ActiveBlock` 을 원장(`TimeLog`)으로 넘기고 지운다.
 * 이게 없으면 밤에 켜둔 블록이 영원히 남아 예산과 통계가 둘 다 틀어진다.
 *
 * ⭐ 인증은 세션이 아니라 `x-cron-secret` 이다 (N-022).
 *    시크릿이 틀리면 401 이 아니라 **404** 를 준다 — 엔드포인트 존재를 알리지 않는다.
 *
 * ⚠️ POST 인 이유: 원장을 바꾸는 호출이다.
 *    GET 으로 열어두면 프리페치·크롤러·CDN 이 정산을 일으킬 수 있다.
 */

/**
 * Vercel 함수 실행시간 상한(초).
 *
 * 회원 수가 늘면 한 번에 다 못 돈다. 그래서 라우트는 시간을 늘리는 대신
 * 서비스가 **한 번에 처리할 대상 수를 잘라** `hasMore` 로 남은 걸 알린다.
 * 워크플로가 `hasMore` 가 false 가 될 때까지 다시 부른다.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
    return withCronSecret(request, async function runBatch() {
        // 도메인 순수 함수는 now 를 인자로 받는다. 시각을 잡는 곳은 여기 한 곳뿐이다.
        const now = nowInAppZone();
        const summary = await runDailySettlement(now);

        // 실행 로그는 Vercel 대시보드에 남는다. 배치는 화면이 없으므로
        // "무엇을 했는지"를 로그로 남기지 않으면 아무도 모른다.
        console.info('[nfs] daily settlement', JSON.stringify(summary));

        return summary;
    });
}
