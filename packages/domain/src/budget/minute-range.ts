import { DateTime } from 'luxon';
import { APP_ZONE, minutesFromStartOfDay, totalMinutesPerDay } from '../time/zone';

/**
 * 하루 안의 시간 구간. **반열린 구간 `[startMinute, endMinute)`** 이다.
 *
 * 왜 분 정수로 다루는가:
 *   구간 병합은 경계 조건 디버깅이 잦다. DateTime 끼리 비교하면
 *   무엇이 무엇보다 큰지 눈으로 검산할 수 없다.
 *   0~1440 정수로 정규화하면 중간값을 그대로 읽을 수 있다.
 *
 * 왜 반열린 구간인가:
 *   `[10:00, 11:00)` 과 `[11:00, 12:00)` 은 **겹치지 않는다.**
 *   닫힌 구간으로 짜면 11:00 이 양쪽에 속해 1분이 중복되거나 사라진다.
 *   이 프로젝트에서 통계가 조용히 틀리는 대표적인 자리다. (테스트계획 §2.1 #4)
 */
export interface MinuteRange {
    startMinute: number;
    endMinute: number;
}

/** 구간 하나의 길이. 음수 길이는 0으로 본다 */
export function lengthOfRange(range: MinuteRange): number {
    const length = range.endMinute - range.startMinute;

    if (length <= 0) {
        return 0;
    }
    return length;
}

/** 구간 목록의 총 분. **겹침을 고려하지 않는다** — 총합(gross)이다 */
export function grossMinutesOf(ranges: readonly MinuteRange[]): number {
    let totalMinutes = 0;

    for (const range of ranges) {
        totalMinutes = totalMinutes + lengthOfRange(range);
    }
    return totalMinutes;
}

/**
 * 겹치는 구간을 합쳐 합집합을 만든다. (정책 §2.1 규칙 2)
 *
 * 단계별로 쓴다 — 이 함수가 틀리면 두 화면의 숫자가 조용히 어긋난다.
 *   1. 길이 0 이하인 구간을 버린다
 *   2. 시작 시각 오름차순으로 정렬한다
 *   3. 앞 구간과 닿거나 겹치면 늘리고, 떨어져 있으면 새로 시작한다
 *
 * 경계가 닿는 경우(`[10,11)` + `[11,12)`)는 `[10,12)` 로 합쳐진다.
 * 합쳐도 총 분은 120으로 같으므로 안전하고, 결과 구간 수가 줄어 다음 계산이 싸진다.
 */
export function mergeMinuteRanges(ranges: readonly MinuteRange[]): MinuteRange[] {
    // 1. 길이 없는 구간 제거
    const meaningfulRanges: MinuteRange[] = [];
    for (const range of ranges) {
        if (lengthOfRange(range) > 0) {
            meaningfulRanges.push({ startMinute: range.startMinute, endMinute: range.endMinute });
        }
    }

    // 2. 정렬 — 시작이 같으면 짧은 것을 먼저 둔다 (결과는 같지만 순서가 결정적이어야 한다)
    meaningfulRanges.sort(function compareByStartThenEnd(left, right) {
        if (left.startMinute !== right.startMinute) {
            return left.startMinute - right.startMinute;
        }
        return left.endMinute - right.endMinute;
    });

    // 3. 병합
    const merged: MinuteRange[] = [];
    for (const range of meaningfulRanges) {
        const previous = merged[merged.length - 1];

        // 첫 구간이거나, 앞 구간과 완전히 떨어져 있으면 새로 시작한다.
        // `>` 인 것이 중요하다 — `>=` 로 쓰면 경계가 닿는 구간을 합치지 못한다.
        if (previous === undefined || range.startMinute > previous.endMinute) {
            merged.push({ startMinute: range.startMinute, endMinute: range.endMinute });
            continue;
        }

        // 겹치거나 닿는다. 더 멀리 가는 경우에만 늘린다 (완전 포함이면 그대로 둔다)
        if (range.endMinute > previous.endMinute) {
            previous.endMinute = range.endMinute;
        }
    }

    return merged;
}

/** 합집합 기준 총 분 */
export function unionMinutesOf(ranges: readonly MinuteRange[]): number {
    return grossMinutesOf(mergeMinuteRanges(ranges));
}

/**
 * `base` 에서 `claimedRanges` 가 이미 차지한 부분을 뺀 나머지를 돌려준다.
 *
 * 겹친 구간의 귀속을 정하는 데 쓴다 (정책 §2.1 규칙 4 — 실측 우선).
 * NFS 블록이 먼저 자리를 차지하고, 캘린더 일정은 **남은 자리만** 가져간다.
 */
export function subtractMinuteRanges(
    base: MinuteRange,
    claimedRanges: readonly MinuteRange[],
): MinuteRange[] {
    if (lengthOfRange(base) === 0) {
        return [];
    }

    const claimed = mergeMinuteRanges(claimedRanges);
    const remainder: MinuteRange[] = [];

    // cursor 는 "아직 남아 있는 부분의 시작점"이다. 왼쪽부터 훑으며 밀어낸다.
    let cursor = base.startMinute;

    for (const block of claimed) {
        if (block.startMinute >= base.endMinute) {
            break; // 이후 구간은 전부 base 오른쪽 바깥이다 (claimed 는 정렬돼 있다)
        }
        if (block.endMinute <= cursor) {
            continue; // 이미 지나온 왼쪽 구간
        }

        // block 앞에 빈 자리가 있으면 그만큼이 나머지다
        if (block.startMinute > cursor) {
            const gapEnd = Math.min(block.startMinute, base.endMinute);
            remainder.push({ startMinute: cursor, endMinute: gapEnd });
        }

        cursor = Math.max(cursor, block.endMinute);

        if (cursor >= base.endMinute) {
            break;
        }
    }

    if (cursor < base.endMinute) {
        remainder.push({ startMinute: cursor, endMinute: base.endMinute });
    }

    return remainder;
}

/** 하루를 날짜별로 쪼갠 조각. 자정을 넘는 블록이 여기서 갈린다 */
export interface DailyMinuteRange extends MinuteRange {
    /** 'yyyy-MM-dd' */
    workDate: string;
}

/**
 * 어떤 구간이 여러 날에 걸쳐 있으면 **날짜 경계로 쪼갠다.** (정책 §2.3)
 *
 * 23:00–01:00 블록은 18일 60분 / 19일 60분으로 갈린다.
 * 24시간 상한이 정직하려면 이렇게 청구해야 한다 —
 * 시작한 날에 120분을 몰아주면 그날 예산만 부당하게 깎인다.
 *
 * ⚠️ 통계 귀속은 이것과 다르다. `stat_date` 는 **시작한 날** 하나뿐이다.
 *    두 기준이 어긋나는 게 정상이고, 각 기능이 목적에 맞게 최적화된 결과다.
 */
export function splitRangeByDate(
    startInstant: DateTime,
    endInstant: DateTime,
): DailyMinuteRange[] {
    const start = startInstant.setZone(APP_ZONE);
    const end = endInstant.setZone(APP_ZONE);

    if (end <= start) {
        return [];
    }

    const pieces: DailyMinuteRange[] = [];
    const minutesPerDay = totalMinutesPerDay();

    let dayStart = start.startOf('day');

    // 하루씩 전진하며 그날에 걸친 부분만 잘라낸다.
    // 블록 최대 길이는 3시간이지만, 캘린더 일정은 여러 날에 걸칠 수 있다.
    while (dayStart < end) {
        const nextDayStart = dayStart.plus({ days: 1 });

        const pieceStart = start > dayStart ? start : dayStart;
        const pieceEnd = end < nextDayStart ? end : nextDayStart;

        // 그날 0시 기준 분 좌표로 정규화한다.
        // 끝이 다음 날 0시면 minutesFromStartOfDay 가 0을 주므로 1440으로 바로잡는다.
        const startMinute = minutesFromStartOfDay(pieceStart);
        const endMinute =
            pieceEnd.toMillis() === nextDayStart.toMillis()
                ? minutesPerDay
                : minutesFromStartOfDay(pieceEnd);

        if (endMinute > startMinute) {
            pieces.push({
                workDate: dayStart.toFormat('yyyy-MM-dd'),
                startMinute: startMinute,
                endMinute: endMinute,
            });
        }

        dayStart = nextDayStart;
    }

    return pieces;
}

/**
 * 어떤 구간을 특정 날짜에 걸친 부분만 남긴다. 그날에 안 걸치면 null.
 *
 * `splitRangeByDate` 의 결과에서 하루만 골라내는 것과 같지만,
 * 하루 예산 계산은 대상 날짜가 정해져 있으므로 이쪽이 의도가 분명하다.
 */
export function clipRangeToDate(
    startInstant: DateTime,
    endInstant: DateTime,
    workDate: string,
): MinuteRange | null {
    const pieces = splitRangeByDate(startInstant, endInstant);

    for (const piece of pieces) {
        if (piece.workDate === workDate) {
            return { startMinute: piece.startMinute, endMinute: piece.endMinute };
        }
    }
    return null;
}
