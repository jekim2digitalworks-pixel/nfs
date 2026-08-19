import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            // 빌드 시점 방어(server-only)를 테스트 러너에서만 우회한다. test/server-only-stub.ts 참조
            'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        // 운영 환경(Vercel)이 UTC 이므로 테스트도 UTC 를 기본으로 둔다 (N-022).
        env: { TZ: 'UTC' },
    },
});
