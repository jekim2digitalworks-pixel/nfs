import { defineConfig } from 'vitest/config';

/**
 * 테스트가 도는 프로세스 타임존 (테스트계획 §6 · #39 · #39-b)
 *
 * 기본은 **UTC** 다 — Vercel 함수와 GitHub Actions 크론의 실제 환경이다 (N-022).
 * 다만 고정하지 않고 밖에서 받은 TZ 를 존중한다. `pnpm test:tz` 가 세 존으로 돌려
 * **결과가 완전히 같은지**를 확인하기 때문이다. 답이 갈리면 존을 아는 곳이
 * 도메인 밖에도 있다는 뜻이고, 그게 이 프로젝트에서 가장 비싼 버그다.
 */
function testTimeZone() {
    const provided = process.env['TZ'];

    if (provided === undefined || provided.length === 0) {
        return 'UTC';
    }
    return provided;
}

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        env: { TZ: testTimeZone() },
    },
});
