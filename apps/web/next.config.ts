import type { NextConfig } from 'next';

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
