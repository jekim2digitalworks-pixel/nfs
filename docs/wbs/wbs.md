# NFS · WBS 마스터

> 🔴 **이 파일이 프로젝트의 단일 진실 원천이다.**
> 세션이 끊기면 여기부터 읽는다. 작업이 끝나면 여기를 갱신한다.

| | |
|---|---|
| 최종 갱신 | **2026-08-20** (세션 종료 시점) |
| 갱신자 | 개발 (아키텍트) |
| 전체 진행률 | **35 / 44 작업 완료 (80%)** · MVP 범위는 41작업 (Phase 5 제외) · B-11 코드 완료 · 실검증 대기 |

---

## 🔴 현재 상태

**지금 단계:** **Phase 2 완료 · Phase 4 마무리 중** — 핵심 3화면(리포트·하루·집중)이 다 돈다

**마지막 커밋:** `f54b44e` feat(B-11) 하루 화면 "캘린더 다시 불러오기" · 2026-08-20
→ **이 세션에서 B-11 마감 연결(N-035) 커밋**

⛔ **이 PC 에서 Vercel 배포가 막혀 있다.** 사내망(DNS `V-CWAD1.coway.io`)이 `vercel.com` ·
`api.vercel.com` · `*.vercel.app` 의 TLS 를 끊는다(curl 35). github.com 은 정상.
**다른 망(테더링 등)에서 배포해야 한다.** 08-19 에 "일시적"으로 적었지만 이틀째 같다.

---

### 🟢 지금 실제로 돌아가는 것

```
로그인      구글 OAuth → HMAC 세션 쿠키 → 회원 생성/갱신 (실제 로그인 성공 확인)
블록        생성 → 시작/정지/재개 → 완료(정산) 전 구간 API 동작
정산        ActiveBlock → TimeLog. 멱등성·겹침차감 실DB 검증 완료
자정 배치   POST /api/jobs/daily-settlement — 어제 이전 블록 전부 정산. 실DB 검증 완료
주간 마감   POST /api/jobs/weekly-closing — 기한 넘긴 주를 동결. 실DB 검증 완료
통계        기간별 집계 · 태그별 · 월별 추이. 실DB 숫자 대조 완료
화면        리포트 · 하루(예산미터·타임라인) · 블록 생성 시트 · **집중(다이얼·서버 동기 타이머)**
캘린더      POST /api/calendar/sync — 이번 주 읽기 + 필터 7종. **아직 실계정으로 안 태웠다**
```

**테스트 205건** (도메인 187 + 웹 18) · lint · typecheck · build 전부 통과

### 📁 코드 지도

```
packages/domain/
  time/        존 유틸 · DATE 컬럼 변환 · timestamptz 변환      (29 테스트)
  budget/      ⭐⭐ 구간 병합 · 예산 계산기 · 등록 검증 · 미리보기  (60)
  block/       생성 검증 · 상태 전이 · 정산 값 계산            (45)
  closing/     주 구간 · 마감 기한 · 캘린더→원장 변환          (24)
  statistics/  기간 범위 · 직전 기간 · 비율                    (17)
  calendar/    필터 7종 · 색상→태그 매핑                    (12)
  errors.ts    에러 코드 7종

packages/db/    schema.prisma 6테이블 — Supabase 에 적용 완료

apps/web/src/
  server/prisma.ts            커넥션 싱글턴 (풀러 + 어댑터)
  server/auth/                세션(HMAC) · 구글 OAuth · 토큰 암호화(AES-GCM)
  server/http/                응답 봉투 · 에러 매핑 · withMember/withCronSecret
  server/services/            member · statistics · block · settlement · closing · day-occupants · calendar-sync
  app/api/                    health · me · auth/* · blocks/* · statistics/* · calendar/sync · jobs/{daily-settlement,weekly-closing}
  app/page.tsx                S-02 리포트  ✅
  app/day/page.tsx            S-03 하루    ✅  (?new=1 이면 생성 시트가 열린 채로 뜬다)
  app/focus/page.tsx          진입 분기    ✅  → /focus/{id} 또는 /day?new=1
  app/focus/[blockId]/        S-04 집중    ✅
  hooks/                      useServerClock(오프셋) · useBlockTimer(표시 전용)  ⭐
  lib/api.ts                  fetch + 봉투 해석 단일 창구 (F-02)
  components/                 chart/Ring · report/* · day/{BudgetMeter,Timeline,BlockSheet} · focus/FocusStage
  styles/                     tokens · base · components · screen-{report,day,block-sheet,focus}
```

### ✅ 이 세션에서 한 것 (2026-08-20) — B-08 · B-09 · D-04 · U-06 · U-05 · F-01

**B-08 자정 정산** (커밋 `2665ea8`)
- `api/jobs/daily-settlement/route.ts` + `services/settlement.ts` 의 `runDailySettlement`
- `.github/workflows/daily-settlement.yml` — `5 15 * * *` = KST 00:05
- 대상은 "어제"가 아니라 `work_date < 오늘(KST)` **전부** → 한 번 걸러도 따라잡는다 (**N-031**)

**B-09 주간 마감**
- `api/jobs/weekly-closing/route.ts` + `services/closing.ts` + `packages/domain/closing/**` (24 테스트)
- `.github/workflows/weekly-closing.yml` — `0 19 * * 0` = **KST 월요일** 04:00 (UTC 로는 일요일)
- 마감 판정은 "지난주니까"가 아니라 **기한(월 04:00) 초과** — 되돌릴 수 없는 작업이라 (**N-032**)
- ✅ **최종 동기화(정책 §3.2 1단계)는 이 세션 오후에 채웠다** (N-035). `performFinalCalendarSync` 가
  `syncCalendarWeek` 을 부른다. 연동돼 있는데 못 읽었으면 `SYNCED` 가 아니라 **`FAILED`** 로 남긴다

두 배치 모두 실DB 로 태워 확인했다(겹침 차감·멱등성·경계). 검증용 행은 전부 삭제했다.

**D-04 시안 E · U-06 블록 생성 시트**
- `docs/디자인/시안-E-블록생성.html` — 기본 / 예산 초과 두 상태
- `components/day/BlockSheet.tsx` + `styles/screen-block-sheet.css` — FAB 이 시트를 연다
- ⭐ 미리보기 판정을 도메인으로 내렸다: `previewWithCandidate` 를 화면이, `assertBlockFitsInBudget` 을
  서버가 쓰되 **같은 비교식**을 공유한다. 파리티 테스트로 묶어뒀다 (**N-033**)
- 🐛 **`screen-day.css` 가 어디에서도 import 되지 않고 있었다** (U-04 부터). 하루 화면이 스타일 없이
  렌더링되고 있었다. `globals.css` 에 추가하고 번들 CSS 를 실제로 grep 해서 확인했다

**U-05 집중 화면 · F-01 타이머**
- `app/focus/[blockId]/page.tsx` + `components/focus/FocusStage.tsx` + `styles/screen-focus.css`
- `hooks/useServerClock.ts`(오프셋) · `hooks/useBlockTimer.ts`(표시 전용) — ⭐ **누적하지 않는다.**
  매 틱마다 `기준 집중초 + (지금 − 기준 시각)` 을 처음부터 다시 계산한다 (**N-034**)
- `/focus` 는 화면이 아니라 분기다 — 진행 중이면 `/focus/{id}`, 없으면 `/day?new=1`(시트가 열린 채)
- 집중 화면에서는 **하단 탭이 사라진다.** 나가는 길은 좌상단 닫기뿐이다
- 시안 C 의 "구글 캘린더에도 남깁니다" 체크박스는 **넣지 않았다** — 쓰기 파이프(B-15)가 Phase 2 다

### ✅ 이 세션에서 추가로 한 것 (2026-08-20 오후) — B-11 마감 연결

**`closing.ts` 의 `performFinalCalendarSync` → `syncCalendarWeek` 연결** (N-032 의 빈 자리를 채웠다)

- 마감 직전 그 주를 한 번 더 읽는다 (정책 §3.2 1단계). 이제 마감의 `SYNCED` 가 살아 있다
- ⭐ **동기화가 실패해도 마감을 진행한다** — `FAILED` 로 기록하고 이미 쌓인 일정으로 닫는다 (**N-035**)
  - 미루면 그 주 일정이 예산 계산기에 점유자로 남아 **하루가 조용히 좁아진다**
  - 토큰 만료(N-028)는 저절로 낫지 않는다 — 미루기만 반복하고 미마감 주가 쌓인다
- `fetch`·DB 예외까지 `try/catch` 로 삼킨다. 위로 새면 `runWeeklyClosing` 이 주를 열어둔 채 넘긴다
- lint · typecheck · **테스트 205건** · build(전 라우트 ƒ) 전부 통과

> 📌 남은 리스크(N-035 에 기록): `closeWeek` 이 회원당 구글 호출 1회를 하게 됐다.
> 회원이 두 자릿수가 되면 `CLOSING_TARGET_LIMIT`(100)을 먼저 낮춘다.

### 🔜 다음에 할 일 (순서대로)

**0. 배포 + GitHub 시크릿 등록** ⛔ **다른 망에서 해야 한다** (사내망이 Vercel 을 막는다)

크론 워크플로 2종은 만들었지만 **아직 한 번도 실제로 돌지 않았다.** 로컬 dev 로만 검증했다.

1. `npx vercel --prod --yes` — 배포본이 U-03·B-06·B-07·U-04·B-08·B-09·U-06·U-05·F-01·F-02·B-11 만큼 뒤처져 있다
2. Vercel 프로젝트 환경변수에 `CRON_SECRET` 확인 (로컬 `.env.local` 과 같은 값이어야 한다)
3. GitHub 레포 Settings → Secrets → `APP_URL`(끝에 `/` 없이), `CRON_SECRET`
4. Actions 탭에서 **두 워크플로를 손으로 한 번씩 돌린다** (`workflow_dispatch`). 크론을 기다리지 않는다
   - 자정 정산: 어제 블록이 없으면 `processedMemberCount: 0` 이 정상
   - 주간 마감: 지난주 캘린더 일정이 없으면 아무것도 안 닫는 게 정상

**1. B-11 실검증** 🟡 ← **코드는 다 됐다. 남은 건 사용자 손이 필요한 확인 하나뿐이다**

- [x] `app/api/calendar/sync/route.ts` — 실패해도 200 + status 로 내려준다
- [x] 하루 화면 헤더 버튼 — 결과를 문구로 구분해 말한다(미연동/토큰만료/N개 불러옴)
- [x] `closing.ts` 최종 동기화 연결 (**N-035**)
- [ ] **실검증** — ⛔ 자동화로 못 한다. 구글 캘린더(사용자 계정)에 테스트 일정을 넣고 브라우저에서 눌러야 한다
      1. 구글 캘린더에 이번 주 일정 4개: **일반 1시간 · 종일 · 내가 거절한 것 · 9시간짜리**
      2. 브라우저에서 로그인 → `/day` → 헤더 "캘린더 다시 불러오기"
      3. `imported_calendar_event` 의 `exclusion_reason` 확인 —
         종일=`ALL_DAY` · 거절=`DECLINED` · 9시간=`TOO_LONG` · 일반=`null`
      - ⚠️ 리프레시 토큰이 7일 만료(N-028)다. `FAILED` 가 뜨면 **재로그인부터**
      - **googleapis.com 은 이 망에서 열린다**(확인함). 막히는 건 vercel 도메인뿐이다

**2. 손으로 한 바퀴 돌려보기** — 브라우저 확장이 연결돼 있지 않아 **클릭 경로를 못 태웠다.**
   서버 경로(SSR·전이 API·리다이렉트)는 전부 확인했지만 다음 두 가지는 눈으로 봐야 한다:
   - `/day` FAB → 칩을 누를 때 미리보기 숫자가 따라오는가
   - `/focus/{id}` 다이얼이 **매초 줄어드는가**, 탭을 백그라운드로 뒀다 돌아왔을 때 값이 튀지 않는가

**3. D-05 · D-06 시안** — 지금 막힌 게 없는 유일한 트랙이다.
   D-05 온보딩·구글 연동 동의 / D-06 빈 상태·로딩·에러.
   특히 **D-06 이 급하다** — 지금 화면들이 빈 상태·실패를 임시 문구로 때우고 있다

**4. T-03 통합 테스트** — 배치 2종 · 동기화 · 타임존(`TZ=UTC`). B-11 이 붙었으니 이제 쓸 수 있다

**5. D-03 시안** — ⛔ Q-010(평생 화면 기준 나이) 답이 먼저다

**6. B-12 색상→태그 매핑** — 읽는 쪽(`loadColorMapping`·`mapCategoryTag`)은 이미 있다.
   **매핑을 만드는 길이 없다** — 서비스·API·화면이 통째로 비어 있어서 지금은 전부 미분류로 들어온다

### ⚠️ 알아둘 것

| 항목 | 상태 |
|---|---|
| **배포본이 로컬보다 뒤처져 있다** | 마지막 CLI 배포 이후 U-03·B-06·B-07·U-04·**B-08·B-09·U-06·U-05·F-01·F-02·B-11** 이 안 올라갔다 |
| ⛔ **이 PC 에서 Vercel 이 안 열린다** | 사내망(DNS `V-CWAD1.coway.io`)이 vercel 도메인의 TLS 를 끊는다 — `npx vercel --prod` 가 `fetch failed`, curl 은 35. DNS 는 정상 해석되고 github 는 200. **다른 망에서 배포할 것** (08-19·08-20 이틀 연속 동일) |
| **크론이 아직 안 돈다** | 워크플로 2종 작성 완료. GitHub 시크릿(`APP_URL`·`CRON_SECRET`) 미등록 + 배포 전이다 |
| `gh` CLI 가 없다 | 그래서 시크릿 등록을 대신 해줄 수 없다. 필요하면 `npm i -g gh` 대신 GitHub 웹 UI 가 빠르다 |
| GitHub Actions 크론의 함정 | 60일간 커밋이 없으면 스케줄이 **비활성화된다.** 오래 쉬었다 돌아오면 Actions 탭에서 다시 켠다 |
| Git 푸시는 Preview 만 만든다 | 프로덕션 배포는 **CLI 로 한다** (N-029) |
| 커밋 작성자 | 저장소 로컬 설정 `you4ranghe@gmail.com` — Vercel 프로젝트 소유 계정과 맞춰둔 것이다. 바꾸면 배포가 차단된다 |
| DB | member 1행 외 전부 비어 있다 (검증 데이터 정리 완료) |
| `CRON_SECRET` | 작업 중 대화창에 노출된 적이 있다. **이제 실제로 쓰인다** — 갈 거면 로컬 `.env.local` · Vercel · GitHub 시크릿 **세 곳**을 같이 바꾼다 |
| 구글 테스트 모드 | 리프레시 토큰이 **7일 만료** (N-028). 캘린더 동기화만 영향, 블록·통계는 무관 |

### 🧭 개발 명령

```
pnpm dev          개발 서버 (3000)
pnpm build        prisma generate + 빌드 — 전 라우트가 ƒ(Dynamic) 이어야 한다
pnpm lint         ⭐ 시간·XSS·서버경계 방어 규칙
pnpm typecheck    전 패키지
pnpm test         전 패키지 (205건)
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
| **0** | 기획 · 디자인 확정 | 9 / 12 | 🟡 |
| **1** | 스캐폴딩 · 스키마 · 배포 골격 | 5 / 6 | 🟡 |
| **2** | 핵심 도메인 · API | 9 / 9 | ✅ **완료** |
| **3** | 구글 캘린더 연동 | 1 / 5 | 🟡 |
| **4** | 화면 구현 | 7 / 9 | 🟡 **지금 여기** |
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
| D-04 | 시안 E — 블록 생성 시트 (기본 · 예산 초과 2상태) | 디자인 | `docs/디자인/시안-E-블록생성.html` | D-01 | ✅ |
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
| O-07 | GitHub Actions 크론 2종 + `CRON_SECRET` | 개발 | `.github/workflows/{daily-settlement,weekly-closing}.yml` | O-06 | 🟡 |

> ⚠️ **O-07의 크론 표현식은 UTC다.** KST 환산 주석을 반드시 병기한다.
> 자정 정산 `5 15 * * *` / 주간 마감 `0 19 * * 0` (**KST 월요일 = UTC 일요일**)
> 🟡 **크론 2종을 다 만들었다.** 남은 것은 배포 + GitHub 레포 시크릿 등록뿐이다 — 그때 ✅ 로 바꾼다.
> ⚠️ **GitHub 레포 시크릿 `APP_URL` · `CRON_SECRET` 을 아직 등록하지 않았다.** 등록 전에는 워크플로가 첫 스텝에서 실패한다.

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
| B-08 | 자정 정산 배치 엔드포인트 | 개발 | `app/api/jobs/daily-settlement/route.ts` · `services/settlement.ts` 의 `runDailySettlement` | B-06, O-07 | ✅ |
| B-09 | 주간 마감 배치 엔드포인트 (월 04:00 KST) | 개발 | `app/api/jobs/weekly-closing/route.ts` · `services/closing.ts` · `packages/domain/closing/**` (24 테스트) | B-06, O-07 | ✅ |
| B-14 | API 명세 확정 + Route Handler 골격 | 개발 | `app/api/{blocks,statistics,auth,me,health}/**` | O-05 | ✅ |

> ⭐⭐ 표시는 **이 프로젝트에서 가장 위험한 두 작업**이다. 여기서 틀리면 통계 숫자가 조용히 틀린다.
> 반드시 단위 테스트를 먼저 쓴다 (T-02, `docs/테스트/01-테스트계획.md` 2·3장).
> **B-05·B-16은 순수 함수라 DB도 계정도 필요 없다. 지금 당장 할 수 있는 가장 가치 있는 작업이다.**

---

## Phase 3 · 구글 캘린더 연동

| ID | 작업 | 역할 | 산출물 | 선행 | 상태 |
|---|---|---|---|---|---|
| B-10 | 구글 OAuth (로그인 + 읽기 스코프 · 토큰 암호화) | 개발 | `server/auth/google-oauth.ts`, `token-cipher.ts` | B-03 | ✅ |
| B-11 | 일정 읽기 동기화 + 필터 7종 | 개발 | `services/calendar-sync.ts` · `api/calendar/sync` · `closing.ts` 최종 동기화 · `packages/domain/calendar/**` (12 테스트) | B-10 | 🟡 **코드 완료 · 실검증만 남음** |
| B-12 | 색상(colorId) → 태그 매핑 | 개발 | `src/server/services/category-mapping.ts` — **읽는 쪽만 있다**(`loadColorMapping`·`mapCategoryTag`). 매핑을 만드는 길이 없어 전부 미분류로 들어온다 | B-11 | ⬜ |
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
| U-05 | 집중 화면 (시안 C → JSX) | 퍼블 | `app/focus/[blockId]/page.tsx` · `components/focus/FocusStage.tsx` · `styles/screen-focus.css` | U-02, D-02 | ✅ |
| U-06 | 블록 생성 시트 | 퍼블 | `components/day/BlockSheet.tsx` · `styles/screen-block-sheet.css` | D-04 | ✅ |
| F-01 | **타이머 (서버 시간 동기 · hydration 안전)** ⭐ | 퍼블 | `hooks/{useServerClock,useBlockTimer}.ts` | B-04 | ✅ |
| F-02 | API 레이어 + 에러 처리 규약 | 퍼블 | `lib/api.ts` — 시트·집중 두 곳 리팩터 완료 | B-14 | ✅ |
| F-03 | 차트 (링 · 캡슐 미터 · 타임라인) | 퍼블 | `components/chart/Ring` · `day/{BudgetMeter,Timeline}` · `focus` 다이얼 | B-07 | ✅ |

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
| T-02 | 단위 테스트 (예산 계산기 · 이관 · 마감) | QA | `packages/domain/**/*.test.ts` — 187건 | B-05, B-06 | ✅ |
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
