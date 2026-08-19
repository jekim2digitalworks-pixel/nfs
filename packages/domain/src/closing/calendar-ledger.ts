import type { DateTime } from 'luxon';
import { splitRangeByDate } from '../budget/minute-range';
import { workDateOf } from '../time/zone';
import type { CategoryTag } from '../types/category-tag';
import type { CompletionType, SourceType } from '../types/block';

/**
 * 캘린더 일정 → 원장 한 줄 (데이터모델 §3.2 · B-09)
 *
 * 자정 정산(B-08)이 `ActiveBlock` 을 넘기듯, 주간 마감은 `ImportedCalendarEvent` 를 넘긴다.
 * 다른 점은 셋이다:
 *
 *   1. **실측이 아니라 신고다.** 타이머가 증명한 시간이 아니므로
 *      겹치면 NFS 블록에 자리를 내준다 (정책 §2.1 규칙 4).
 *   2. **여러 날에 걸칠 수 있다.** 블록은 최대 3시간이지만 일정은 사흘짜리도 있다.
 *      그래서 겹침을 **날짜별로** 재고 합친다.
 *   3. **원장 행은 하나다.** `UNIQUE(member, source_type, source_reference_key)` 가
 *      이벤트 하나에 한 줄만 허용한다 — 날짜별로 쪼개 넣을 수 없다.
 *      귀속일(`statDate`)은 블록과 같은 규칙, **시작한 날**이다 (정책 §2.3).
 */

/** 마감 대상 일정 하나. DB 행이 아니라 계산에 필요한 값만 추린 모양이다 */
export interface CalendarEventSnapshot {
    /** 멱등성 키가 된다. 구글 이벤트 id */
    googleEventId: string;
    title: string;
    categoryTag: CategoryTag;
    startTime: DateTime;
    endTime: DateTime;
}

/** 원장에 들어갈 한 줄 */
export interface CalendarLedgerDraft {
    sourceType: SourceType;
    sourceReferenceKey: string;
    title: string;
    categoryTag: CategoryTag;
    statDate: string;
    startTime: DateTime;
    endTime: DateTime;
    plannedMinutes: number;
    actualFocusMinutes: number;
    overlapDeductedMinutes: number;
    completionType: CompletionType;
    pauseCount: number;
}

/**
 * 이 일정이 걸친 날짜들. (예: 23:00~01:00 이면 이틀)
 *
 * 서비스가 이 목록으로 **날짜별 점유자**를 읽어 겹침을 잰다.
 * 예산 계산기가 하루 단위이기 때문에, 여러 날짜에 걸친 일정은
 * 날짜 수만큼 계산기를 돌리고 결과를 더하는 것 외에 방법이 없다 —
 * 그리고 그게 맞다. "하루 1440분" 상한은 날짜별로 성립하는 규칙이다.
 */
export function datesSpannedBy(startTime: DateTime, endTime: DateTime): string[] {
    const pieces = splitRangeByDate(startTime, endTime);

    const dates: string[] = [];
    for (const piece of pieces) {
        dates.push(piece.workDate);
    }
    return dates;
}

/**
 * 원장 한 줄을 만든다.
 *
 * @param grossMinutes             걸친 날짜들에서 잰 총 길이 (자정을 넘어도 전부 더한 값)
 * @param overlapDeductedMinutes   그중 다른 일정에 자리를 내준 분
 *
 * ⭐ **`actualFocusMinutes` 는 신고 시간에서 겹침을 뺀 값이다.**
 *    빼지 않으면 캘린더에 회의를 이중으로 잡아둔 사람의 하루가 30시간이 된다.
 *
 * ⚠️ 음수를 방어한다. 원장은 UPDATE 하지 않으므로 한 번 들어간 음수는
 *    통계 합계를 영원히 갉아먹는다 (N-030 에서 실제로 겪었다).
 */
export function buildCalendarLedgerDraft(
    event: CalendarEventSnapshot,
    grossMinutes: number,
    overlapDeductedMinutes: number,
): CalendarLedgerDraft {
    let deducted = overlapDeductedMinutes;

    if (deducted < 0) {
        deducted = 0;
    }
    if (deducted > grossMinutes) {
        deducted = grossMinutes;
    }

    let attributedMinutes = grossMinutes - deducted;

    if (attributedMinutes < 0) {
        attributedMinutes = 0;
    }

    return {
        sourceType: 'GOOGLE_CALENDAR',
        sourceReferenceKey: event.googleEventId,
        title: event.title,
        categoryTag: event.categoryTag,
        // 귀속일은 **시작한 날**. 블록과 같은 규칙을 쓴다 — 규칙이 둘이면 통계가 갈린다
        statDate: workDateOf(event.startTime),
        startTime: event.startTime,
        endTime: event.endTime,
        // 캘린더 일정에는 "계획"이 따로 없다. 잡아둔 길이가 곧 계획이다.
        // 0 을 넣으면 "계획 대비 달성률" 화면이 0으로 나누게 된다
        plannedMinutes: grossMinutes,
        actualFocusMinutes: attributedMinutes,
        overlapDeductedMinutes: deducted,
        completionType: 'CALENDAR_IMPORTED',
        // 캘린더 일정에 일시정지 개념이 없다. 0 이 사실이다
        pauseCount: 0,
    };
}

/**
 * 원장에 넣을 가치가 있는가. (데이터모델 §3.2 — "0분이면 스킵")
 *
 * 겹침으로 전부 깎여 0분이 된 일정은 넣지 않는다.
 * 넣어도 통계 합계는 같지만, 리포트 목록에 0분짜리 유령 항목이 쌓인다.
 */
export function isWorthRecording(draft: CalendarLedgerDraft): boolean {
    return draft.actualFocusMinutes > 0;
}
