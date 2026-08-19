import { config as loadEnvFile } from 'dotenv';
import type { NextConfig } from 'next';

/**
 * 환경변수는 **저장소 루트의 .env.local** 한 곳에만 둔다.
 *
 * Next.js 는 자기 프로젝트 폴더(apps/web)의 .env.local 만 자동으로 읽는다.
 * 모노레포에서 그대로 두면 앱용·Prisma용 .env 가 두 벌이 되고, 언젠가 한쪽만 고쳐진다.
 * (단일 프로젝트인 Vite 등에서는 루트가 곧 프로젝트라 이 문제가 없다)
 *
 * next.config 는 dev·build 시작 시 가장 먼저 평가되므로 여기서 읽으면
 * 서버 컴포넌트와 Route Handler 모두 process.env 로 값을 본다.
 * override:false — Vercel 이 주입한 실제 환경변수를 덮어쓰지 않는다.
 */
loadEnvFile({ path: '../../.env.local', override: false, quiet: true });

const nextConfig: NextConfig = {
    // 워크스페이스 패키지는 빌드 산출물이 아니라 TypeScript 소스를 그대로 내보낸다.
    // 별도 빌드 단계를 두지 않는 대신, 번들러가 직접 트랜스파일하게 한다.
    // 이렇게 해야 packages/domain 을 고쳤을 때 별도 빌드 없이 즉시 반영된다.
    transpilePackages: ['@nfs/domain', '@nfs/db'],

    // Cache Components(use cache)는 MVP에서 켜지 않는다.
    // NFS 화면은 거의 전부 회원별 동적 데이터라 캐시할 대상이 없고,
    // 새 캐싱 모델을 얹으면 "남의 통계가 보이는" 사고 면적만 넓어진다.
};

export default nextConfig;
