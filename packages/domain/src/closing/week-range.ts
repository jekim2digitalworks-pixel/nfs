import type { DateTime } from 'luxon';
import { APP_ZONE, parseAppDate, weekStartDateOf } from '../time/zone';

/**
 * 주간 마감의 시간 규칙 (정책 §3 · B-09)
 *
 * 주는 **월요일 00:00 에 시작해 다음 월요일 00:00 직전까지**다.
 * 마감은 그 주가 끝나고 **4시간 뒤인 월요일 04:00** 에 돈다 —
 * 일요일 밤늦게 일하거나 캘린더를 정리하는 사람에게 주는 유예다 (정책 §3.3).
 *
 * ⚠️ 이 4시간이 크론에서 **요일을 바꾼다.**
 *    KST 월요일 04:00 = UTC 일요일 19:00 → `0 19 * * 0`.
 *    존을 안 따지고 `* * 1` 로 적으면 마감이 하루 늦게 돈다.
 */

/** 마감 시각(KST 기준 시). 주가 끝나고 이만큼 뒤에 마감한다 */
export const WEEK_CLOSING_HOUR = 4;

export interface WeekRange {
    /** 그 주 월요일 00:00 (포함) */
    startInstant: DateTime;
    /** 다음 주 월요일 00:00 (**미포함**) */
    endInstant: DateTime;
}

/**
 * 주 식별자(월요일 날짜)를 실제 시각 구간으로 바꾼다.
 *
 * 끝을 "일요일 23:59:59" 로 두지 않고 **다음 월요일 0시(미포함)** 로 두는 이유:
 * 초·밀리초 경계에서 한 칸씩 새는 버그를 원천 차단한다.
 * 구간 비교는 전부 `start <= t < end` 한 가지 모양으로 쓴다.
 */
export function weekRangeOf(weekStartDate: string): WeekRange {
    const startInstant = parseAppDate(weekStartDate);
    const endInstant = startInstant.plus({ days: 7 });

    return {
        startInstant: startInstant,
        endInstant: endInstant,
    };
}

/**
 * 그 주의 마감 기한 — **다음 주 월요일 04:00 (KST)**.
 *
 * `startOf('day')` 를 거친 뒤 시각을 더한다. 존을 옮긴 상태에서 계산해야
 * UTC 로 도는 배치에서도 같은 답이 나온다.
 */
export function closingDeadlineOf(weekStartDate: string): DateTime {
    const range = weekRangeOf(weekStartDate);
    return range.endInstant.plus({ hours: WEEK_CLOSING_HOUR });
}

/**
 * 지금 이 주를 마감해도 되는가.
 *
 * 마감은 **되돌릴 수 없다** (재개봉 없음 · 정책 §3.3).
 * 그래서 "지난주니까 닫는다"가 아니라 **기한을 넘겼는가**로 판단한다.
 * 배치가 밀려서 화요일에 돌든 손으로 목요일에 돌리든 같은 답이 나온다.
 */
export function isWeekClosable(weekStartDate: string, now: DateTime): boolean {
    const deadline = closingDeadlineOf(weekStartDate);
    const nowInAppZone = now.setZone(APP_ZONE);

    return nowInAppZone >= deadline;
}

/**
 * 마감 대상의 상한선 — **이 날짜보다 앞선 주만 닫는다.**
 *
 * 진행 중인 주를 닫으면 그 주의 캘린더를 다시 읽는 경로가 영영 사라진다 (정책 §3.2).
 * "지난주 하나"가 아니라 "이번 주보다 앞선 전부"를 상한으로 주는 이유는
 * 자정 정산과 같다 — 배치가 한 주 걸러도 다음 실행이 따라잡아야 한다 (N-031).
 */
export function openWeekStartDateOf(now: DateTime): string {
    return weekStartDateOf(now);
}
