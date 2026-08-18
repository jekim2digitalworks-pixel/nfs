/**
 * Prisma 스키마와 생성된 클라이언트의 단일 출구.
 *
 * 아직 비어 있다 — 스키마 작성은 O-03 작업이다.
 * (docs/개발/02-데이터모델.md 의 테이블 6종을 packages/db/prisma/schema.prisma 로 옮긴다)
 *
 * O-03 이후 이 파일은 다음을 내보낸다:
 *   - 생성된 모델 타입 (Member, ActiveBlock, TimeLog …)
 *   - Prisma enum (CategoryTag, BlockStatus …)
 *
 * PrismaClient 인스턴스는 여기서 만들지 않는다.
 * 커넥션 수명은 앱이 관리해야 하므로 apps/web/src/server/prisma.ts 의 싱글턴이 소유한다.
 * (docs/개발/01-아키텍처.md §7 — 서버리스 커넥션 고갈)
 */
export const DB_PACKAGE_PLACEHOLDER = true;
