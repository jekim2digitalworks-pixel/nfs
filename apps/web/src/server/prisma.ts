import 'server-only';
import { PrismaClient, PrismaPg } from '@nfs/db';

/**
 * Prisma 커넥션 — ⭐ **모듈 스코프 싱글턴** (아키텍처 §7)
 *
 * 서버리스에서 가장 흔한 사고가 커넥션 고갈이다.
 * 핸들러 안에서 `new PrismaClient()` 를 부르면 호출마다 커넥션이 늘어나고,
 * 개발 중에는 멀쩡하다가 트래픽이 조금 붙는 순간 한도에 닿아 **갑자기 터진다.**
 *
 * 방어는 세 겹이다:
 *   1. 이 파일이 클라이언트를 딱 하나만 만든다
 *   2. DATABASE_URL 이 Supabase 풀러(6543) + connection_limit=1 을 가리킨다
 *   3. 개발 모드 핫 리로드가 매번 새 클라이언트를 만들지 않게 globalThis 에 붙여둔다
 */

function createPrismaClient(): PrismaClient {
    const connectionString = process.env['DATABASE_URL'];

    if (connectionString === undefined || connectionString.length === 0) {
        // 여기서 죽는 편이 낫다. undefined 로 넘어가면
        // "데이터베이스에 연결할 수 없다"는 엉뚱한 오류로 나타난다.
        throw new Error('DATABASE_URL 이 없습니다. .env.local 또는 Vercel 환경변수를 확인하세요.');
    }

    // Prisma 7 은 런타임 커넥션을 드라이버 어댑터로 받는다.
    // 스키마의 datasource 에는 url 이 없다 — 그건 CLI(마이그레이션) 전용이다 (N-025).
    const adapter = new PrismaPg({ connectionString: connectionString });

    return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { nfsPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.nfsPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.nfsPrisma = prisma;
}
