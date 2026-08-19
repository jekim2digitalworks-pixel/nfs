/**
 * 표시 형식 변환.
 *
 * ⭐ **서버는 분 단위 정수만 내려준다** (API명세 §4).
 *    표시 형식을 서버가 정하면 화면마다 다른 포맷이 필요할 때 API를 고쳐야 한다.
 *    그래서 변환은 전부 여기서 한다.
 */

/** 분 → `52:10` (시간:분). 미터·목록 값처럼 폭이 일정해야 하는 자리에 쓴다 */
export function formatHourMinute(totalMinutes: number): string {
    const safeMinutes = Math.max(0, Math.round(totalMinutes));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;

    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/** 증감 표시. 0이면 부호를 붙이지 않는다 */
export function formatDelta(deltaMinutes: number): string {
    if (deltaMinutes === 0) {
        return '0:00';
    }
    const sign = deltaMinutes > 0 ? '+' : '−';
    return `${sign}${formatHourMinute(Math.abs(deltaMinutes))}`;
}

/** 히어로 숫자의 조각. 숫자와 단위의 크기·색을 분리하려고 나눈다 (디자인 §3.4) */
export interface HeroTimeParts {
    hours: number;
    minutes: number;
}

export function splitHeroTime(totalMinutes: number): HeroTimeParts {
    const safeMinutes = Math.max(0, Math.round(totalMinutes));

    return {
        hours: Math.floor(safeMinutes / 60),
        minutes: safeMinutes % 60,
    };
}

/** `2시간 20분` — 문장 안에 들어가는 자리 (인사이트 카드 등) */
export function formatKoreanDuration(totalMinutes: number): string {
    const { hours, minutes } = splitHeroTime(totalMinutes);

    if (hours === 0) {
        return `${minutes}분`;
    }
    if (minutes === 0) {
        return `${hours}시간`;
    }
    return `${hours}시간 ${minutes}분`;
}
