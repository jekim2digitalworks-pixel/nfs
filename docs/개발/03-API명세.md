# NFS API 명세

| 항목 | 내용 |
|---|---|
| 버전 | **v1.0** (Route Handlers · N-023 반영 · B-14 진행 중) |
| 최종 갱신 | 2026-08-19 |
| 작성 | 20년차 백엔드 아키텍트 |
| 선행 | `01-아키텍처.md` · `../기획/02-화면정의서.md` |

공통 응답 규약과 에러 코드는 `01-아키텍처.md` 8장 참조.
모든 API는 세션 인증이 필요하며, **`memberId`는 세션 쿠키에서 꺼낸다. 요청 파라미터로 받지 않는다.**

**엔드포인트는 전부 Next.js Route Handler다** — `POST /api/blocks` ↔ `app/api/blocks/route.ts`.
모든 핸들러에 `runtime = 'nodejs'` · `dynamic = 'force-dynamic'` 을 명시한다 (`01-아키텍처.md` §3.1).

---

## 1. 페이지 (App Router)

| 경로 | 파일 | 화면 |
|---|---|---|
| `/` | `app/page.tsx` | S-02 리포트 |
| `/day` | `app/day/page.tsx` | S-03 하루 |
| `/focus/{blockId}` | `app/focus/[blockId]/page.tsx` | S-04 집중 |
| `/lifetime` | `app/lifetime/page.tsx` | S-06 평생 |
| `/settings` | `app/settings/page.tsx` | S-07 설정 |
| `/onboarding` | `app/onboarding/page.tsx` | S-01 온보딩 |

⭐ **초기 데이터는 Server Component가 서비스 함수를 직접 호출해 얻는다.**
아래 API들은 **화면 진입 후의 갱신용**이다. 같은 프로세스이므로 첫 렌더에서 자기 API를 fetch 하지 않는다.
**첫 화면을 클라이언트에서 다시 불러오지 않는다** — 스켈레톤이 깜빡이고 체감 속도가 나빠진다.

---

## 2. 블록

### `POST /api/blocks` — 블록 생성

```json
{ "categoryTag": "DEVELOPMENT", "title": "설계 문서 정리",
  "plannedStartTime": "2026-08-18T14:00:00", "plannedMinutes": 60,
  "startImmediately": true }
```

**검증 순서** — 태그 필수 → 길이(30배수·30~180) → 격자 정렬 → **예산 초과**

```json
{ "success": true,
  "data": { "activeBlockId": 812, "blockStatus": "RUNNING",
            "budgetAfter": { "occupiedMinutes": 660, "remainingMinutes": 780 } } }
```

예산 초과 시 `BUDGET_EXCEEDED` + `detail.occupiedBy[]` 에 점유 내역을 담아
화면이 *"무엇이 자리를 차지하는지"* 를 바로 보여줄 수 있게 한다 (정책 2.4).

### 상태 전이

| 메서드 | 경로 | 비고 |
|---|---|---|
| `POST` | `/api/blocks/{id}/start` | `READY → RUNNING` |
| `POST` | `/api/blocks/{id}/pause` | `RUNNING → PAUSED` |
| `POST` | `/api/blocks/{id}/resume` | `PAUSED → RUNNING` |
| `POST` | `/api/blocks/{id}/complete` | 정산 → `TimeLog`. `EARLY_FINISHED` 또는 `NORMAL_COMPLETED` |
| `DELETE` | `/api/blocks/{id}` | 정산 → `ABANDONED` |

모든 전이 응답에 **서버 기준 시각**을 함께 내린다. 클라 타이머는 이 값으로 재동기화한다.

```json
{ "success": true,
  "data": { "blockStatus": "RUNNING", "serverTime": "2026-08-18T14:07:33",
            "accumulatedFocusSeconds": 420, "lastResumedTime": "2026-08-18T14:00:33" } }
```

### `GET /api/blocks/current` — 진행 중인 블록

탭 전환·재진입·포커스 복귀 시 호출. 없으면 `data: null`.

---

## 3. 하루

### `GET /api/day?date=2026-08-18`

```json
{ "success": true, "data": {
  "budget": { "totalMinutes": 1440, "occupiedMinutes": 630, "remainingMinutes": 810,
              "calendarMinutes": 420, "blockMinutes": 210, "overlapMinutes": 90,
              "minutesUntilMidnight": 593 },
  "blocks": [ { "activeBlockId": 812, "title": "설계 문서 정리", "categoryTag": "DEVELOPMENT",
                "startTime": "2026-08-18T14:00:00", "endTime": "2026-08-18T15:00:00",
                "blockStatus": "RUNNING", "overlapDeductedMinutes": 60 } ],
  "events": [ { "importedEventId": 5501, "title": "파트너사 미팅", "categoryTag": "MEETING",
                "startTime": "2026-08-18T14:00:00", "endTime": "2026-08-18T16:00:00",
                "excludedFromStatistics": false, "overlapDeductedMinutes": 60 } ],
  "calendarSync": { "status": "SYNCED", "lastSyncedTime": "2026-08-18T13:58:00" } } }
```

`overlapMinutes`를 따로 내리는 이유: 화면이 *"겹친 N분은 한 번만 셌습니다"* 를 표시해야 하는데,
프론트에서 다시 계산하면 서버와 어긋날 수 있다. **계산은 한 곳에서만 한다.**

### `POST /api/calendar/events/{id}/exclude`

```json
{ "excluded": true }
```
NFS 쪽 플래그만 바꾼다. **구글 원본은 건드리지 않는다.**

---

## 4. 통계

| 메서드 | 경로 | 용도 |
|---|---|---|
| `GET` | `/api/statistics/summary?period=MONTH&date=2026-08-01` | 히어로 총계 + 전기 대비 |
| `GET` | `/api/statistics/by-tag?period=MONTH&date=2026-08-01` | 링 + 목록 |
| `GET` | `/api/statistics/monthly?year=2026` | 12개월 추이 |
| `GET` | `/api/statistics/insight?period=MONTH&date=2026-08-01` | 인사이트 카드 (없으면 `null`) |

`period` = `DAY` / `WEEK` / `MONTH` / `YEAR`

```json
// by-tag
{ "success": true, "data": {
  "totalMinutes": 11250, "focusMinutes": 5780, "calendarMinutes": 5470,
  "tags": [ { "categoryTag": "DEVELOPMENT", "focusMinutes": 2290, "calendarMinutes": 840,
              "totalMinutes": 3130, "sharePercent": 27.8, "deltaMinutes": 380 } ] } }
```

**분 단위 정수로만 내린다.** `"52:10"` 같은 표시 형식은 프론트가 만든다 —
서버가 표시 형식을 정하면 화면마다 다른 포맷이 필요할 때 API를 고쳐야 한다.

주간 조회 응답에는 마감 상태를 포함한다.
```json
"closing": { "status": "CLOSED", "calendarSyncResult": "SYNCED", "closedTime": "2026-08-18T04:00:12" }
```

---

## 5. 구글 캘린더

| 메서드 | 경로 | 용도 |
|---|---|---|
| `GET` | `/api/google/auth-url?scope=READ_ONLY` | 동의 화면 URL |
| `GET` | `/api/google/callback` | OAuth 콜백 |
| `POST` | `/api/google/sync` | 열린 주 수동 동기화 |
| `GET` | `/api/google/calendars` | 사용자 캘린더 목록 (반영 대상 선택용) |
| `PUT` | `/api/google/calendars` | 반영할 캘린더 저장 |
| `GET` / `PUT` | `/api/google/color-mapping` | 색상 → 태그 매핑 |
| `DELETE` | `/api/google/connection` | 연동 해제 (토큰 즉시 파기) |

동기화 응답:
```json
{ "success": true, "data": { "importedCount": 14, "excludedCount": 3,
    "excludedByReason": { "ALL_DAY": 1, "DECLINED": 1, "TOO_LONG": 1 },
    "lastSyncedTime": "2026-08-18T14:07:00" } }
```

**제외된 것의 개수와 사유를 반드시 내린다.** 조용히 빼면 사용자는 통계가 틀렸다고 느낀다.

---

## 6. 배치 (⭐ 내부 전용 · N-022)

**GitHub Actions 크론만 호출한다.** 세션이 아니라 `x-cron-secret` 헤더로 인증한다.

| 메서드 | 경로 | 크론 (UTC) | KST |
|---|---|---|---|
| `POST` | `/api/jobs/daily-settlement` | `5 15 * * *` | 매일 00:05 |
| `POST` | `/api/jobs/weekly-closing` | `0 19 * * 0` | **월** 04:00 |

⚠️ 주간 마감이 크론에서 **일요일(`0`)** 인 이유: KST 월요일 04:00 = UTC 일요일 19:00. 요일까지 밀린다.

```json
// 자정 정산 응답 — 무엇을 했고 무엇이 남았는지 반드시 내린다 (B-08 구현 확정)
{ "success": true, "data": {
    "processedMemberCount": 128, "settledBlockCount": 341, "skippedBlockCount": 12,
    "failedMemberIds": [ "5501" ], "failedBlockIds": [ "88214" ],
    "hasMore": false } }

// 주간 마감 응답 (B-09 구현 확정)
{ "success": true, "data": {
    "processedMemberCount": 128, "closedWeekCount": 131,
    "importedEventCount": 806, "skippedEventCount": 47,
    "failedMemberIds": [], "hasMore": false } }
```

> `closedWeekCount` 가 `processedMemberCount` 보다 클 수 있다 — 밀린 주를 한 회원이 여러 개 닫는다.
> `skippedEventCount` 는 겹침으로 0분이 되어 원장에 넣지 않은 일정 수다.

**대상 선정 (N-031 · N-032)** — 배치는 "어제/지난주 하나"가 아니라 **밀린 것 전부**를 걷어간다.

| 배치 | 대상 | 상한 |
|---|---|---|
| 자정 정산 | `work_date < 오늘(KST)` 인 모든 블록 | (회원 × 날짜) 200쌍 |
| 주간 마감 | `week_start_date < 이번 주` **그리고** 기한(월 04:00) 초과 | (회원 × 주) 100쌍 |

- **`hasMore: true`면 워크플로가 다시 호출한다.** 함수 실행시간 상한 때문에 한 번에 다 못 돌 수 있다
- 배치는 **멱등하다.** 겹쳐 호출돼도 `TimeLog` UNIQUE가 중복을 막는다
- 시크릿 불일치 시 **404**를 반환한다 (401이 아니라 — 엔드포인트 존재를 알리지 않는다)
- 한 회원의 실패가 배치 전체를 멈추지 않는다. `failedMemberIds`로 보고하고 계속 진행한다

---

## 7. 아직 정하지 않은 것

| 항목 | 비고 |
|---|---|
| 세션 발급 흐름 상세 | **구글 로그인 단독 확정**(N-014). `/api/google/auth-url` + `/api/google/callback` 이 로그인을 겸한다. 세션 생성·갱신 규약은 B-03에서 확정 |
| 캘린더 쓰기 API | Phase 2 (B-15) |
| 페이지네이션 | 통계는 기간 한정이라 당장 불필요. 원장 상세 조회 추가 시 검토 |
