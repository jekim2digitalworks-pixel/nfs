import { withEnvelope } from '@/server/http/withMember';
import { prisma } from '@/server/prisma';
import { nowInAppZone, toAppLocalString } from '@nfs/domain/time';

/**
 * 헬스체크 — 배포 직후 "실제로 살아 있는가"를 한 번에 본다.
 *
 * 세 가지를 동시에 확인한다:
 *   1. 앱이 뜬다
 *   2. DB 커넥션이 잡힌다 (풀러 설정이 맞는가)
 *   3. **서버가 보는 '지금'이 한국 시간인가** — 함수는 UTC 로 도는데 KST 가 나와야 한다
 *
 * 회원 데이터를 전혀 건드리지 않으므로 세션 없이 연다.
 */
export async function GET(): Promise<Response> {
    return withEnvelope(async function checkHealth() {
        const startedAt = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        const databaseLatencyMs = Date.now() - startedAt;

        const now = nowInAppZone();

        return {
            status: 'ok',
            serverTime: toAppLocalString(now),
            timeZone: now.zoneName,
            databaseLatencyMs: databaseLatencyMs,
        };
    });
}
