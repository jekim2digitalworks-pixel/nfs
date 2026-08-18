import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        // 이 패키지의 테스트는 프로세스 타임존에 영향받지 않아야 한다 (N-022).
        // 운영 환경(Vercel · GitHub Actions)이 UTC 이므로 그 조건을 기본값으로 둔다.
        env: { TZ: 'UTC' },
    },
});
