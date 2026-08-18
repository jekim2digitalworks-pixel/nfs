import { DateTime } from 'luxon';

/**
 * 이 파일은 NFS에서 "타임존을 아는 유일한 곳"이다.
 *
 * 왜 한 곳에 가두는가:
 *   운영 환경(Vercel 함수 · GitHub Actions 크론)은 UTC로 돈다.
 *   프로세스 TZ를 Asia/Seoul로 고정하는 방식은 서버리스에서 쓸 수 없다.
 *   그래서 방어선을 "환경 설정"이 아니라 "코드"로 내렸다.
 *   다른 파일에 'Asia/Seoul' 문자열이 나타나면 그건 이 규칙이 새고 있다는 신호다.
 *
 * 참조: docs/개발/01-아키텍처.md §6.1 · docs/wbs/decision-log.md N-022
 */
export const APP_ZONE = 'Asia/Seoul';

/** 하루가 끝나는 시각. 자정 정산의 기준이다. */
const MINUTES_PER_DAY = 1440;

/**
 * 지금 시각을 앱 타임존으로 얻는다.
 *
 * 도메인 순수 함수는 이 함수를 직접 부르지 않는다. now를 인자로 받는다.
 * (그래야 자정 5분 전 같은 상황을 테스트에서 만들 수 있다 — 아키텍처 §2.1)
 * 이 함수는 서비스 계층의 진입점에서 한 번만 호출한다.
 */
export function nowInAppZone(): DateTime {
    return DateTime.now().setZone(APP_ZONE);
}

/**
 * 어떤 시각이 "며칠에 속하는가"를 판단한다. (work_date · stat_date)
 *
 * 반드시 존을 옮긴 뒤 날짜를 뽑는다.
 * UTC 2026-08-18T15:30Z 은 한국에서 이미 8월 19일이다.
 */
export function workDateOf(instant: DateTime): string {
    const inAppZone = instant.setZone(APP_ZONE);
    return inAppZone.toFormat('yyyy-MM-dd');
}

/**
 * 그 시각이 속한 주의 월요일 날짜를 얻는다. (weekStartDate)
 *
 * ISO 주차(2026-W34) 대신 월요일 날짜를 키로 쓰는 이유는
 * 연말·연초에 ISO 주차가 해를 넘나들며 정렬이 깨지기 때문이다.
 * 날짜 문자열은 그냥 사전순으로 정렬하면 시간순이다.
 *
 * Luxon의 startOf('week')에 맡기지 않고 직접 계산한다.
 * 주 시작 요일은 라이브러리 버전·로케일 설정에 따라 달라질 수 있는 값이고,
 * 이 프로젝트에서 "주"는 마감 배치가 걸린 도메인 개념이라 바깥에 맡기면 안 된다.
 */
export function weekStartDateOf(instant: DateTime): string {
    const inAppZone = instant.setZone(APP_ZONE);

    // Luxon weekday: 월요일 1 … 일요일 7
    const daysSinceMonday = inAppZone.weekday - 1;
    const monday = inAppZone.minus({ days: daysSinceMonday });

    return monday.toFormat('yyyy-MM-dd');
}

/**
 * 'yyyy-MM-dd' 문자열을 앱 타임존의 그날 0시로 해석한다.
 *
 * new Date('2026-08-19') 는 UTC 자정으로 파싱되어 한국 시간 09:00이 된다.
 * 이 프로젝트에서 그건 "하루가 통째로 밀리는" 버그다.
 */
export function parseAppDate(dateString: string): DateTime {
    const parsed = DateTime.fromISO(dateString, { zone: APP_ZONE });

    if (!parsed.isValid) {
        throw new Error(`날짜 형식이 올바르지 않습니다: ${dateString}`);
    }
    return parsed.startOf('day');
}

/**
 * '2026-08-19T14:00:00' 같은 존 없는 로컬 시각 문자열을 앱 타임존으로 해석한다.
 *
 * API는 존 표기 없는 로컬 시각을 주고받는다 (docs/개발/03-API명세.md).
 * 단일 타임존 전제이므로 존을 실어 보내면 오히려 클라이언트마다 해석이 갈린다.
 */
export function parseAppDateTime(localDateTimeString: string): DateTime {
    const parsed = DateTime.fromISO(localDateTimeString, { zone: APP_ZONE });

    if (!parsed.isValid) {
        throw new Error(`시각 형식이 올바르지 않습니다: ${localDateTimeString}`);
    }
    return parsed;
}

/**
 * 응답에 실을 로컬 시각 문자열로 바꾼다. ('2026-08-19T14:00:00')
 *
 * 존 표기(+09:00)와 밀리초를 빼는 이유는 API 명세가 그 형식으로 고정돼 있고,
 * 클라이언트가 문자열을 그대로 비교하는 자리가 있기 때문이다.
 */
export function toAppLocalString(instant: DateTime): string {
    const inAppZone = instant.setZone(APP_ZONE);
    return inAppZone.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * 그 시각으로부터 그날 자정까지 남은 분.
 *
 * 하루 화면이 "자정까지 N분"을 표시하고, 블록 생성 시 남은 예산의 상한이 된다.
 */
export function minutesUntilMidnight(instant: DateTime): number {
    const inAppZone = instant.setZone(APP_ZONE);
    const nextMidnight = inAppZone.plus({ days: 1 }).startOf('day');

    const remainingMinutes = nextMidnight.diff(inAppZone, 'minutes').minutes;

    // 초 단위를 버리고 분으로 내린다. 올림하면 자정을 넘긴 예산이 잡힌다.
    return Math.floor(remainingMinutes);
}

/**
 * 그날 0시를 기준으로 몇 분이 지난 시각인가. (0 ~ 1440)
 *
 * 예산 계산기는 구간을 [시작분, 끝분) 정수로 다룬다.
 * DateTime 끼리 비교하는 대신 분으로 정규화하면 경계 조건을 눈으로 검산할 수 있다.
 */
export function minutesFromStartOfDay(instant: DateTime): number {
    const inAppZone = instant.setZone(APP_ZONE);
    const startOfDay = inAppZone.startOf('day');

    const elapsedMinutes = inAppZone.diff(startOfDay, 'minutes').minutes;
    return Math.floor(elapsedMinutes);
}

/** 하루의 총 분. 24시간 예산의 상한이다. */
export function totalMinutesPerDay(): number {
    return MINUTES_PER_DAY;
}
