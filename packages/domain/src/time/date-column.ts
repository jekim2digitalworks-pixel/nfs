import { DateTime } from 'luxon';
import { APP_ZONE } from './zone';

/**
 * 날짜만 담는 값(work_date · stat_date · week_start_date)의 표현을 변환한다.
 *
 * 왜 이 파일이 필요한가:
 *   도메인과 API 는 날짜를 'yyyy-MM-dd' **문자열**로 다룬다. 오해의 여지가 없기 때문이다.
 *   그런데 Postgres 의 DATE 컬럼은 드라이버를 거치며 **JS Date(UTC 자정)** 으로 오간다.
 *
 *   두 표현을 아무 데서나 변환하면 이 프로젝트 1순위 버그가 재발한다.
 *   '2026-08-19' 를 한국 시간 0시로 만들어 저장하면 UTC 로는 2026-08-18T15:00 이고,
 *   DATE 컬럼에 들어갈 때 **8월 18일로 잘린다.** 하루가 통째로 밀린다.
 *
 * 그래서 규약을 하나로 고정한다:
 *   **DATE 컬럼은 "그 날짜의 UTC 자정"으로만 표현한다.**
 *   타임존 변환을 하지 않는다 — 애초에 시각이 아니라 달력 위의 한 칸이기 때문이다.
 *
 * 이 변환은 저장소 계층에서만 쓴다. 서비스와 화면은 문자열만 본다.
 */

/** 'yyyy-MM-dd' → DATE 컬럼에 넣을 값 (그 날짜의 UTC 자정) */
export function dateStringToDateColumn(dateString: string): Date {
    const parsed = DateTime.fromISO(dateString, { zone: 'utc' });

    if (!parsed.isValid) {
        throw new Error(`날짜 형식이 올바르지 않습니다: ${dateString}`);
    }
    return parsed.startOf('day').toJSDate();
}

/** DATE 컬럼에서 읽은 값 → 'yyyy-MM-dd' */
export function dateColumnToDateString(dateColumn: Date): string {
    // 존을 옮기지 않고 UTC 로 그대로 읽는다.
    // 여기서 setZone(APP_ZONE) 을 하면 UTC 자정이 한국 시간 09:00 이 되고,
    // 겉보기엔 같은 날이라 통과하지만 — 다른 표준시로 배포하는 순간 날짜가 흔들린다.
    const asUtc = DateTime.fromJSDate(dateColumn, { zone: 'utc' });

    if (!asUtc.isValid) {
        throw new Error('DATE 컬럼 값이 올바르지 않습니다');
    }
    return asUtc.toFormat('yyyy-MM-dd');
}

/**
 * 어떤 순간이 속한 날짜를 바로 DATE 컬럼 값으로 바꾼다.
 *
 * 순서가 중요하다: **먼저 한국 시간으로 옮겨 날짜를 정한 뒤**, 그 날짜를 UTC 자정으로 만든다.
 * 순서를 바꾸면 UTC 15:30(= 한국 다음 날) 이 전날로 기록된다.
 */
export function instantToDateColumn(instant: DateTime): Date {
    const dateStringInAppZone = instant.setZone(APP_ZONE).toFormat('yyyy-MM-dd');
    return dateStringToDateColumn(dateStringInAppZone);
}
