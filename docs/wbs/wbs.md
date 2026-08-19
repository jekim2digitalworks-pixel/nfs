# NFS · WBS 마스터

> 🔴 **이 파일이 프로젝트의 단일 진실 원천이다.**
> 세션이 끊기면 여기부터 읽는다. 작업이 끝나면 여기를 갱신한다.

| | |
|---|---|
| 최종 갱신 | **2026-08-19** (세션 종료 시점) |
| 갱신자 | 개발 (아키텍트) |
| 전체 진행률 | **26 / 44 작업 완료 (59%)** · MVP 범위는 41작업 (Phase 5 제외) |

---

## 🔴 현재 상태

**지금 단계:** **Phase 2 거의 끝 · Phase 4 진행 중** — 배치만 남기고 핵심 흐름이 다 돌아간다

**마지막 커밋:** `c470005` feat(U-04) · 2026-08-19

---

### 🟢 지금 실제로 돌아가는 것

```
로그인      구글 OAuth → HMAC 세션 쿠키 → 회원 생성/갱신 (실제 로그인 성공 확인)
블록        생성 → 시작/정지/재개 → 완료(정산) 전 구간 API 동작
정산        ActiveBlock → TimeLog. 멱등성·겹침차감 실DB 검증 완료
통계        기간별 집계 · 태그별 · 월별 추이. 실DB 숫자 대조 완료
화면        리포트(링·목록·월별) · 하루(예산미터·타임라인) 렌더 확인
```

**테스트 162건** (도메인 144 + 웹 18) · lint · typecheck · build 전부 통과

### 📁 코드 지도

```
packages/domain/
  time/        존 유틸 · DATE 컬럼 변환 · timestamptz 변환      (29 테스트)
  budget/      ⭐⭐ 구간 병합 · 예산 계산기 · 등록 검증        (53)
  block/       생성 검증 · 상태 전이 · 정산 값 계산            (45)
  statistics/  기간 범위 · 직전 기간 · 비율                    (17)
  errors.ts    에러 코드 7종

packages/db/    schema.prisma 6테이블 — Supabase 에 적용 완료

apps/web/src/
  server/prisma.ts            커넥션 싱글턴 (풀러 + 어댑터)
  server/auth/                세션(HMAC) · 구글 OAuth · 토큰 암호화(AES-GCM)
  server/http/                응답 봉투 · 에러 매핑 · withMember/withCronSecret
  server/services/            member · statistics · block · settlement · day-occupants
  app/api/                    health · me · auth/* · blocks/* · statistics/*
  app/page.tsx                S-02 리포트  ✅
  app/day/page.tsx            S-03 하루    ✅
  app/focus/page.tsx          S-04 집중    ⬜ 껍데기
  components/                 chart/Ring · report/* · day/*
  styles/                     tokens · base · components · screen-report · screen-day
```

### 🔜 내일 할 일 (순서대로)

**1. O-07 크론 + B-08 자정 정산** ← 여기서 시작

지금 밤에 켜둔 블록을 닫아줄 게 없다. 실제로 쓰면 `ActiveBlock` 이 계속 쌓인다.

- `app/api/jobs/daily-settlement/route.ts` — `withCronSecret` 은 이미 있다(O-05)
- 서비스도 이미 있다: `settleAllBlocksOfDate(memberId, workDate, now, 'MIDNIGHT_BATCH')`
- 회원 단위로 순회 · 한 명 실패가 전체를 막지 않는다 · 응답에 `hasMore`
- `export const maxDuration = 60`
- `.github/workflows/daily-settlement.yml`

⚠️ **크론은 UTC다. KST 환산 주석을 반드시 병기한다.**
```
자정 정산  KST 00:05    →  cron: '5 15 * * *'
주간 마감  KST 월 04:00 →  cron: '0 19 * * 0'   ← 일요일! 요일까지 밀린다
```
`workflow_dispatch` 를 넣고 **손으로 한 번 돌려서 확인한다.** 크론을 하루 기다리지 않는다.

**2. U-06 블록 생성 시트** — 지금 하루 화면의 FAB 이 자리만 잡고 있다 (D-04 시안 먼저)

**3. B-09 주간 마감** · **F-01 타이머** · **U-05 집중 화면**

### ⚠️ 알아둘 것

| 항목 | 상태 |
|---|---|
| **배포본이 로컬보다 뒤처져 있다** | 마지막 CLI 배포 이후 U-03·B-06·B-07·U-04 가 안 올라갔다. `npx vercel --prod --yes` 한 번이면 된다 |
| Vercel 접속 | 2026-08-19 저녁 기준 이 PC 에서 `vercel.com` SSL 연결 실패(curl 35). github 는 정상 — 일시적 네트워크로 보인다 |
| Git 푸시는 Preview 만 만든다 | 프로덕션 배포는 **CLI 로 한다** (N-029) |
| 커밋 작성자 | 저장소 로컬 설정 `you4ranghe@gmail.com` — Vercel 프로젝트 소유 계정과 맞춰둔 것이다. 바꾸면 배포가 차단된다 |
| DB | member 1행 외 전부 비어 있다 (검증 데이터 정리 완료) |
| `CRON_SECRET` | 작업 중 대화창에 노출됐다. 아직 아무 데도 안 쓰이지만 **O-07 착수 전에 갈아두는 게 좋다** (로컬 `.env.local` + Vercel 양쪽) |
| 구글 테스트 모드 | 리프레시 토큰이 **7일 만료** (N-028). 캘린더 동기화만 영향, 블록·통계는 무관 |

### 🧭 개발 명령

```
pnpm dev          개발 서버 (3000)
pnpm build        prisma generate + 빌드 — 전 라우트가 ƒ(Dynamic) 이어야 한다
pnpm lint         ⭐ 시간·XSS·서버경계 방어 규칙
pnpm typecheck    전 패키지
pnpm test         전 패키지 (162건)
pnpm db:migrate   스키마 변경 시

npx vercel --prod --yes      ⭐ 프로덕션 배포 (Git 푸시로는 안 된다)
npx vercel logs <url>        실패하면 추측 전에 이것부터
```

⚠️ 세션 안에서 시각이 필요하면 `TZ=Asia/Seoul date` 를 믿지 않는다 (Git Bash 가 Windows 에서 무시한다).
`/api/health` 의 `serverTime` 을 쓴다.

### 📌 미결

| | |
|---|---|
| Q-010 | 평생 화면(S-06)의 기준 나이 — D-03 시안을 막고 있다 |
| D-04 | 블록 생성 시트 시안 — U-06 을 막고 있다 |

---

## 상태 기호

| 기호 | 뜻 |
|---|---|
| ✅ | 완료 — 산출물 문서가 존재하고 검토됨 |
| 🟡 | 진행 중 |
| ⬜ | 대기 |
| ⛔ | 블로킹 — 선행 작업이나 사용자 결정이 필요 |
| 🅿️ | MVP 제외 (Phase 2 이후) |

---

## 진행 현황 대시보드

| Phase | 이름 | 진행 | 상태 |
|---|---|---|---|
| **0** | 기획 · 디자인 확정 | 8 / 12 | 🟡 |
| **1** | 스캐폴딩 · 스키마 · 배포 골격 | 5 / 6 | 🟡 |
| **2** | 핵심 도메인 · API | 8 / 9 | 🟡 **지금 여기** |
| **3** | 구글 캘린더 연동 | 1 / 5 | 🟡 |
| **4** | 화면 구현 | 4 / 9 | 🟡 |
| **5** | 깊이 줌 | 0 / 3 | 🅿️ **MVP 제외** (N-013) |
| **6** | 품질 · 운영 | 1 / 4 | ⬜ |

---

## Phase 0 · 기획 · 디자인 확정

| ID | 작업 | 역할 | 산출물 | 선행 | 상태 |
|---|---|---|---|---|---|
| P-01 | 제품 기획서 | 기획 | `docs/기획/01-기획서.md` | — | ✅ |
| P-02 | 서비스 정책서 (예산·마감·겹침·태그) | 기획 | `docs/기획/03-서비스정책.md` | P-01 | ✅ |
| P-03 | 화면정의서 | 기획 | `docs/기획/02-화면정의서.md` | P-01, D-02 | ✅ |
| D-01 | 디자인 시스템 (토큰·타입·모션) | 디자인 | `docs/디자인/01-디자인시스템.md` | — | ✅ |
| D-02 | 시안 A/B/C (리포트·하루·집중) | 디자인 | `docs/디자인/시안-A~C.html` | D-01 | ✅ |
| D-03 | 시안 D — z=0 평생 (438,000시간) | 디자인 | `docs/디자인/시안-D-평생.html` | D-01, (Q-010) | ⬜ |
| D-04 | 시안 E — 블록 생성 시트 | 디자인 | `docs/디자인/시안-E-블록생성.html` | D-01 | ⬜ |
| D-05 | 온보딩 · 구글 연동 동의 화면 | 디자인 | `docs/디자인/시안-F-온보딩.html` | P-02 | ⬜ |
| D-06 | 빈 상태 · 로딩 · 에러 화면 | 디자인 | `docs/디자인/시안-G-상태.html` | D-02 | ⬜ |
| W-01 | WBS · 결정 로그 · 미결 사항 체계 | 기획 | `docs/wbs/*.md` | — | ✅ |
| A-01 | 아키텍처 설계 (**v3.0** — N-022/023 반영) | 개발 | `docs/개발/01-아키텍처.md` | P-02 | ✅ |
| A-02 | 데이터 모델 설계 (**v2.0** — Postgres) | 개발 | `docs/개발/02-데이터모델.md` | P-02 | ✅ |

---

## Phase 1 · 스캐폴딩 · 스키마 · 배포 골격

> **이 Phase에 로컬 설치 작업이 없다.** Node·pnpm이 이미 있고 DB는 클라우드다 (Q-009 소멸).

| ID | 작업 | 역할 | 산출물 | 선행 | 상태 |
|---|---|---|---|---|---|
| O-02 | pnpm 모노레포 + Next.js + Prisma 스캐폴딩 | 개발 | `pnpm-workspace.yaml`, `apps/web/`, `packages/*`, `eslint.config.mjs` | — | ✅ |
| O-03 | Prisma 스키마 6종 + 초기 마이그레이션 SQL | 개발 | `packages/db/prisma/schema.prisma`, `prisma/migrations/…_init/` | O-02, A-02 | ✅ |
| O-04 | Supabase 연결 + 스키마 적용 | 개발 | `.env.local`(로컬) · 마이그레이션 적용 완료 | O-03 | ✅ |
| O-05 | 공통 규약 골격 (Zod · `withMember` · 에러 매핑) | 개발 | `src/server/{prisma,http,auth}/**` (12 테스트) | O-02 | ✅ |
| O-06 | Vercel 첫 배포 | 개발 | https://nfs-web-five.vercel.app | O-04 | ✅ |
| O-07 | GitHub Actions 크론 2종 + `CRON_SECRET` | 개발 | `.github/workflows/*.yml` | O-06 | ⬜ |

> ⚠️ **O-07의 크론 표현식은 UTC다.** KST 환산 주석을 반드시 병기한다.
> 자정 정산 `5 15 * * *` / 주간 마감 `0 19 * * 0` (**KST 월요일 = UTC 일요일**)

---

## Phase 2 · 핵심 도메인 · API

| ID | 작업 | 역할 | 산출물 | 선행 | 상태 |
|---|---|---|---|---|---|
| B-05 | **24시간 예산 계산기 (구간 병합)** ⭐⭐ | 개발 | `packages/domain/budget/**` (53 테스트) | — | ✅ |
| B-16 | 시간 유틸 (`APP_ZONE` · workDate · weekStartDate) ⭐ | 개발 | `packages/domain/time/**` (19 테스트) | — | ✅ |
| B-04 | 블록 생명주기 (생성·시작·정지·재개·완료) | 개발 | `packages/domain/block/**` (41 테스트). 서비스 계층은 O-05 이후 | B-16, O-03 | ✅ |
| B-06 | **이관 트랜잭션 (ActiveBlock → TimeLog, 멱등)** ⭐⭐ | 개발 | `server/services/{settlement,day-occupants}.ts` | B-04 | ✅ |
| B-03 | 구글 로그인 + 세션 쿠키 (N-014) | 개발 | `app/api/auth/**`, `server/auth/**` (18 테스트) | O-05 | ✅ |
| B-07 | 통계 집계 (일/주/월/년) | 개발 | `packages/domain/statistics/**` (17) · `server/services/statistics.ts` · `api/statistics/**` | O-03 | ✅ |
| B-08 | 자정 정산 배치 엔드포인트 | 개발 | `app/api/jobs/daily-settlement/route.ts` | B-06, O-07 | ⬜ |
| B-09 | 주간 마감 배치 엔드포인트 (월 04:00 KST) | 개발 | `app/api/jobs/weekly-closing/route.ts` | B-06, O-07 | ⬜ |
| B-14 | API 명세 확정 + Route Handler 골격 | 개발 | `app/api/{blocks,statistics,auth,me,health}/**` | O-05 | ✅ |

> ⭐⭐ 표시는 **이 프로젝트에서 가장 위험한 두 작업**이다. 여기서 틀리면 통계 숫자가 조용히 틀린다.
> 반드시 단위 테스트를 먼저 쓴다 (T-02, `docs/테스트/01-테스트계획.md` 2·3장).
> **B-05·B-16은 순수 함수라 DB도 계정도 필요 없다. 지금 당장 할 수 있는 가장 가치 있는 작업이다.**

---

## Phase 3 · 구글 캘린더 연동

| ID | 작업 | 역할 | 산출물 | 선행 | 상태 |
|---|---|---|---|---|---|
| B-10 | 구글 OAuth (로그인 + 읽기 스코프 · 토큰 암호화) | 개발 | `server/auth/google-oauth.ts`, `token-cipher.ts` | B-03 | ✅ |
| B-11 | 일정 읽기 동기화 + 필터 7종 | 개발 | `src/server/services/calendar-sync.ts` | B-10 | ⬜ |
| B-12 | 색상(colorId) → 태그 매핑 | 개발 | `src/server/services/category-mapping.ts` | B-11 | ⬜ |
| B-13 | 가입 시 1회 과거 백필 (4~8주) | 개발 | `src/server/services/backfill.ts` | B-11, B-09 | ⬜ |
| B-15 | 쓰기 파이프 + 에코 루프 차단 | 개발 | `src/server/services/calendar-export.ts` | B-11 | 🅿️ Phase 2 |

---

## Phase 4 · 화면 구현

| ID | 작업 | 역할 | 산출물 | 선행 | 상태 |
|---|---|---|---|---|---|
| U-01 | 퍼블리싱 가이드 (**v2.0** — Next.js) | 퍼블 | `docs/퍼블/01-퍼블리싱가이드.md` | D-01 | ✅ |
| U-02 | 토큰 CSS + 루트 셸 + 하단 탭 | 퍼블 | `src/styles/*.css`, `app/layout.tsx`, `components/layout/FloatingTabs` | U-01 | ✅ |
| U-03 | 리포트 화면 (시안 A → JSX) | 퍼블 | `app/page.tsx`, `components/{chart,report}/**`, `lib/format.ts` | U-02, D-02 | ✅ |
| U-04 | 하루 화면 (시안 B → JSX) | 퍼블 | `app/day/page.tsx`, `components/day/{BudgetMeter,Timeline}` | U-02, D-02 | ✅ |
| U-05 | 집중 화면 (시안 C → JSX) | 퍼블 | `app/focus/[blockId]/page.tsx` | U-02, D-02 | ⬜ |
| U-06 | 블록 생성 시트 | 퍼블 | `components/block/BlockSheet.tsx` | D-04 | ⬜ |
| F-01 | **타이머 (서버 시간 동기 · hydration 안전)** ⭐ | 퍼블 | `hooks/useServerClock.ts` | B-04 | ⬜ |
| F-02 | API 레이어 + 에러 처리 규약 | 퍼블 | `lib/api.ts` | B-14 | ⬜ |
| F-03 | 차트 (링 · 캡슐 미터 · 타임라인) | 퍼블 | `components/chart/**` | B-07 | ⬜ |

> U-03~U-05는 확정 시안 HTML을 **JSX로 재작성**하는 작업이다 (N-021에서 받아들인 대가).
> 마크업·CSS는 거의 그대로 옮기고, 상태만 React로 바꾼다.

---

## Phase 5 · 깊이 줌 🅿️ MVP 제외 (N-013)

MVP 출시 후 착수한다. 착수 시 `cal_bak` 라이선스/이력을 정리한다.

| ID | 작업 | 역할 | 산출물 | 상태 |
|---|---|---|---|---|
| F-10 | `cal_bak/camera.ts` 이식 + `DEPTH_ROWS` 재정의 | 퍼블 | `lib/camera.ts` | 🅿️ |
| F-11 | 깊이 렌더러 (transform + CSS 변수 알파) | 퍼블 | `components/depth/**` | 🅿️ |
| F-12 | 핀치/휠 입력 + 탭 점프 연결 (`animateTo`) | 퍼블 | `hooks/useDepthInput.ts` | 🅿️ |

> ⭐ **이제 TS 프로젝트라 이식 장벽이 사라졌다.** N-002(TS 번들 예외)를 되살릴 필요도 없다 —
> 스택 전환의 예상 못 한 이득이다.

---

## Phase 6 · 품질 · 운영

| ID | 작업 | 역할 | 산출물 | 선행 | 상태 |
|---|---|---|---|---|---|
| T-01 | 테스트 계획 (46 케이스) | QA | `docs/테스트/01-테스트계획.md` | P-02 | ✅ |
| T-02 | 단위 테스트 (예산 계산기 · 이관 · 마감) | QA | `packages/domain/**/*.test.ts` | B-05, B-06 | ⬜ |
| T-03 | 통합 테스트 (배치 · 동기화 · **타임존**) | QA | `apps/web/**/*.test.ts` | B-09, B-11 | ⬜ |
| O-10 | 운영 문서 (환경변수 · 크론 · 장애 복구) | 개발 | `docs/개발/04-배포.md` | O-07 | ⬜ |

> ⚠️ **T-03의 타임존 테스트는 `TZ=UTC`로 돌린다.** 그게 Vercel/Actions의 실제 환경이다.
> 예전(EC2 전제)에는 "UTC면 실패해야 한다"였지만 이제 **"UTC에서 전부 통과해야 한다"** 로 뒤집혔다 (N-022).

---

## 갱신 규칙 (반드시 지킬 것)

작업을 하나 끝낼 때마다 **이 파일에서 3곳을 고친다.**

1. 해당 작업 행의 **상태 기호**를 바꾼다 (`⬜` → `🟡` → `✅`)
2. 상단 **「🔴 현재 상태」** 의 *다음에 할 일* 과 *블로커* 를 다시 쓴다
3. 상단 **진행률**과 **대시보드** 숫자를 맞춘다

결정을 내렸으면 `decision-log.md`에, 막혔으면 `open-questions.md`에 각각 남긴다.

> 갱신하지 않은 채 세션이 끊기면 **다음 세션은 이미 한 일을 다시 한다.**
> 이 파일을 고치는 데 드는 30초가 프로젝트에서 가장 값싼 보험이다.
