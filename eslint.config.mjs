import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * NFS 린트 규약 — 워크스페이스 전체를 이 파일 하나가 관장한다.
 *
 * 여기 있는 규칙 대부분은 "스타일"이 아니라 **이 프로젝트가 실제로 밟는 함정**을 막는 것이다.
 * 규칙은 사람이 기억하는 게 아니라 도구가 막아야 한다. (docs/개발/01-아키텍처.md §6.1)
 */

/**
 * ⭐ 시간 함정 — raw Date 산술과 존 없는 '지금'을 막는다.
 *
 * Date.now()는 막지 않는다. epoch 밀리초는 존이 없어 모호하지 않고,
 * 타이머의 서버 오프셋 계산(useServerClock)이 정당하게 쓴다.
 * 위험한 건 문자열 파싱(new Date('2026-08-19') → UTC 자정)과 밀리초 덧셈이다.
 */
const timeSafetyRules = {
    'no-restricted-syntax': [
        'error',
        {
            selector: "NewExpression[callee.name='Date']",
            message:
                'new Date() 금지. @nfs/domain/time 의 parseAppDate · parseAppDateTime 을 쓴다. ' +
                "new Date('2026-08-19') 는 UTC 자정으로 파싱되어 한국에서 하루가 밀린다.",
        },
        {
            selector:
                "CallExpression[callee.object.name='DateTime'][callee.property.name='now']",
            message:
                'DateTime.now() 직접 호출 금지. 존이 붙지 않아 UTC 로 잡힌다. ' +
                '@nfs/domain/time 의 nowInAppZone() 을 쓰고, 도메인 함수는 now 를 인자로 받는다.',
        },
        {
            selector: "Literal[value='Asia/Seoul']",
            message:
                "'Asia/Seoul' 은 packages/domain/src/time 밖에 나타나면 안 된다. " +
                'APP_ZONE 을 import 해서 쓴다 — 존을 아는 곳은 한 군데여야 한다.',
        },
    ],
};

export default defineConfig([
    globalIgnores([
        '**/.next/**',
        '**/out/**',
        '**/build/**',
        '**/dist/**',
        '**/node_modules/**',
        '**/next-env.d.ts',
        '**/generated/**',
    ]),

    // ── Next.js 앱 ────────────────────────────────────────────────
    {
        files: ['apps/web/**/*.{ts,tsx,mts}'],
        extends: [...nextVitals, ...nextTs],
        rules: {
            // App Router 전용이다. pages/ 디렉터리를 전제한 규칙은 경고만 뿜고 쓸모가 없다.
            '@next/next/no-html-link-for-pages': 'off',
        },
    },
    {
        files: ['apps/web/src/**/*.{ts,tsx}'],
        rules: {
            ...timeSafetyRules,

            // XSS — 사용자 입력이 들어가는 자리는 블록 제목과 캘린더 일정 제목 두 곳이다.
            // React 가 기본 이스케이프하므로, 그 방어를 끄는 문법 자체를 금지한다.
            'react/no-danger': 'error',
        },
    },
    {
        // 클라이언트로 번들되는 코드가 서버 코드를 끌어오면
        // Prisma 커넥션 문자열과 구글 시크릿이 브라우저로 나갈 수 있다.
        files: ['apps/web/src/{components,hooks,lib}/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@/server', '@/server/*', '**/server/**'],
                            message:
                                '클라이언트 번들 대상 코드는 src/server 를 import 하지 않는다. ' +
                                '필요한 값은 서버 컴포넌트가 props 로 내려준다.',
                        },
                        {
                            group: ['@prisma/client', '@nfs/db', '@nfs/db/*'],
                            message: 'Prisma 는 서버에서만 쓴다. 화면 코드는 DTO 만 받는다.',
                        },
                    ],
                },
            ],
        },
    },

    // ── 순수 도메인 ───────────────────────────────────────────────
    {
        files: ['packages/domain/src/**/*.ts'],
        extends: [...nextTs],
        rules: {
            ...timeSafetyRules,

            // packages/domain 의 철칙 1·2: 프레임워크·DB·I/O 의존 0
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['next', 'next/*', 'react', 'react-dom', '@prisma/client', '@nfs/db'],
                            message:
                                'packages/domain 은 순수 함수만 둔다. 프레임워크·DB 를 import 하지 않는다. ' +
                                '(docs/개발/01-아키텍처.md §2.1)',
                        },
                    ],
                },
            ],
        },
    },
    {
        // 존을 아는 유일한 파일. 여기서만 'Asia/Seoul' 리터럴과 DateTime.now() 가 허용된다.
        files: ['packages/domain/src/time/**/*.ts'],
        rules: { 'no-restricted-syntax': 'off' },
    },
    {
        // 테스트는 경계 상황을 만들어야 하므로 시간 규칙에서 제외한다.
        // 오히려 여기서 raw Date 를 써야 "밀리는지"를 검증할 수 있다.
        files: ['**/*.test.{ts,tsx}'],
        rules: { 'no-restricted-syntax': 'off' },
    },
]);
