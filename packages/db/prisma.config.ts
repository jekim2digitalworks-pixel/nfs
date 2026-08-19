import { config as loadEnvFile } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI 설정 (Prisma 7).
 *
 * ⚠️ 여기 있는 datasource.url 은 **CLI 전용**이다 — migrate · db pull · studio 가 쓴다.
 *    애플리케이션 런타임 커넥션은 여기서 오지 않는다.
 *    앱은 드라이버 어댑터로 직접 넘긴다 (docs/개발/01-아키텍처.md §7).
 *
 * 그래서 URL 이 둘로 갈린다:
 *   DIRECT_URL   (5432)  → 마이그레이션. 이 파일.
 *   DATABASE_URL (6543 풀러) → 런타임. apps/web 의 PrismaClient.
 *
 * 풀러(pgBouncer)로 마이그레이션을 시도하면 준비된 구문을 지원하지 않아 실패한다.
 * Prisma 6까지 있던 datasource.directUrl 은 7에서 사라졌고, 이렇게 분리하는 것이 그 자리를 대신한다.
 */

/**
 * 환경변수는 **저장소 루트의 `.env.local`** 에 있다.
 *
 * `import 'dotenv/config'` 만 쓰면 프로세스 cwd 의 `.env` 를 찾는다.
 * Prisma CLI 는 `packages/db` 에서 도는 경우가 많아 루트 파일을 놓친다 —
 * 그러면 URL 이 undefined 인 채로 "데이터베이스에 연결할 수 없다"는 엉뚱한 오류가 난다.
 *
 * 그래서 후보 경로를 명시적으로 훑는다. 앞에서 찾은 값이 이긴다(override 하지 않는다).
 * 실행 위치가 루트든 packages/db 든 같은 파일을 읽게 하려는 것이다.
 */
const ENV_FILE_CANDIDATES = [
    '../../.env.local', // packages/db 에서 실행할 때
    '.env.local', // 저장소 루트에서 실행할 때
    '../../.env',
    '.env',
];

for (const candidate of ENV_FILE_CANDIDATES) {
    loadEnvFile({ path: candidate, override: false, quiet: true });
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: process.env['DIRECT_URL'],

        // migrate dev 는 드리프트 감지를 위해 섀도 DB 를 쓴다.
        // Supabase 무료 티어는 DB 를 하나만 주므로 로컬/별도 인스턴스를 가리키게 한다.
        // 운영에서 쓰는 migrate deploy 는 섀도 DB 가 필요 없다.
        shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
    },
});
