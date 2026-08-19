/**
 * Prisma 스키마와 생성된 클라이언트의 단일 출구.
 *
 * ⚠️ `generated/` 는 커밋하지 않는다. 스키마에서 다시 만들면 되는 산출물이고,
 *    커밋하면 스키마와 어긋난 채로 굳는다.
 *    대신 루트 `postinstall` 이 `prisma generate` 를 돌려 클론 직후에도 타입이 맞는다.
 *
 * ⚠️ PrismaClient **인스턴스**는 여기서 만들지 않는다.
 *    Prisma 7은 런타임 커넥션을 드라이버 어댑터로 받는데, 그 수명(풀·싱글턴)은
 *    앱이 관리해야 한다. → apps/web/src/server/prisma.ts
 *    (docs/개발/01-아키텍처.md §7 — 서버리스 커넥션 고갈)
 */

// 모델 타입 · enum · PrismaClient 클래스
export * from '../generated/prisma/client';

// 어댑터는 앱이 인스턴스를 만들 때 필요하다. 버전을 한 곳에 묶어두기 위해 여기서 재수출한다
export { PrismaPg } from '@prisma/adapter-pg';
