import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI 설정 (Prisma 7).
 *
 * ⚠️ 여기 있는 datasource.url 은 **CLI 전용**이다 — migrate · db pull · studio 가 쓴다.
 *    애플리케이션 런타임 커넥션은 여기서 오지 않는다.
 *    앱은 드라이버 어댑터로 직접 넘긴다 (docs/개발/01-아키텍처.md §7).
 *
 * 그래서 URL 이 둘로 갈린다:
 *   DIRECT_URL   (5432 직결)  → 마이그레이션. 이 파일.
 *   DATABASE_URL (6543 풀러)  → 런타임. apps/web 의 PrismaClient.
 *
 * 풀러(pgBouncer)로 마이그레이션을 시도하면 준비된 구문을 지원하지 않아 실패한다.
 * Prisma 6까지 있던 datasource.directUrl 은 7에서 사라졌고, 이렇게 분리하는 것이 그 자리를 대신한다.
 */
export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: process.env['DIRECT_URL'],

        // migrate dev 는 드리프트 감지를 위해 섀도 DB 를 쓴다.
        // Supabase 무료 티어는 DB 를 하나만 주므로 로컬/별도 인스턴스를 가리키게 한다.
        // 없으면 Prisma 가 대상 DB 옆에 임시 DB 를 만들려 시도하다 권한에서 막힌다.
        shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
    },
});
