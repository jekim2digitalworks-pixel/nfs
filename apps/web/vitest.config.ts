import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        // 운영 환경(Vercel)이 UTC 이므로 테스트도 UTC 를 기본으로 둔다 (N-022).
        env: { TZ: 'UTC' },
    },
});
