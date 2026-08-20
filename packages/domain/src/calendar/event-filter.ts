import type { DateTime } from 'luxon';
import type { CategoryTag } from '../types/category-tag';

/**
 * 캘린더 읽기 필터 (정책 §4.2) ⭐
 *
 * **안 거르면 통계가 즉시 망가진다.**
 * 종일 일정 하나에 24시간이 꽂히고, 안 간 회의가 내 시간으로 잡히고,
 * 우리가 쓴 일정을 우리가 다시 읽어 이중 집계된다.
 *
 * 이 파일은 "무엇을 버릴지"만 판단한다 — 순수 함수다.
 * 구글을 부르는 일과 DB 에 넣는 일은 서비스(B-11)가 한다.
 *
 * ⭐ **버리지 않고 `제외 사유`를 남긴다.** 행은 저장하되 통계에서만 뺀다.
 *   사용자가 "왜 이 일정이 안 잡혔지"를 물을 때 답할 수 있어야 하고,
 *   나중에 규칙이 바뀌면 다시 계산할 수 있어야 한다.
 */

/**
 * 제외 사유. **enum 이 아니라 문자열이다** (데이터모델 §2.4).
 * 필터는 운영하면서 늘어난다 — enum 이면 사유 하나 추가에 마이그레이션이 필요하다.
 */
export const EXCLUSION_REASONS = ['ALL_DAY', 'DECLINED', 'TOO_LONG', 'NFS_ORIGIN', 'USER'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/** 8시간을 넘는 일정은 "휴가"·"출장" 같은 덩어리다 (정책 §4.2 #4) */
export const MAX_EVENT_MINUTES = 8 * 60;

/** 구글 이벤트에서 판단에 필요한 것만 추린 모양 */
export interface CalendarEventCandidate {
    googleEventId: string;
    title: string;
    startTime: DateTime;
    endTime: DateTime;
    /** 종일 일정인가 (구글이 `start.date` 로만 주는 것) */
    isAllDay: boolean;
    /** 내가 참석을 거절했는가 */
    isDeclinedByMe: boolean;
    /** NFS 가 써 넣은 일정인가 (`extendedProperties.private` 표식) */
    isWrittenByNfs: boolean;
    /** 구글 이벤트 색상. 태그 매핑 1순위 */
    colorId: string | null;
}

export interface FilterDecision {
    /** 통계에서 뺄 것인가 */
    excluded: boolean;
    /** 뺀다면 왜. 통과하면 null */
    reason: ExclusionReason | null;
}

export function eventMinutesOf(candidate: CalendarEventCandidate): number {
    const minutes = candidate.endTime.diff(candidate.startTime, 'minutes').minutes;
    return Math.floor(minutes);
}

/**
 * 필터 7종 (정책 §4.2)
 *
 * | # | 대상 | 처리 |
 * |---|---|---|
 * | 1 | 종일 일정 | 제외 — 하나에 24시간이 꽂힌다 |
 * | 2 | 공휴일·구독 캘린더 | **여기서 안 한다** — 어떤 캘린더를 읽을지에서 갈린다 |
 * | 3 | 참석 거절 | 제외 — 안 간 회의는 내 시간이 아니다 |
 * | 4 | 8시간 초과 | 제외 — "휴가"·"출장" 덩어리 |
 * | 5 | NFS 가 쓴 일정 | 제외 — 에코 루프 차단 |
 * | 6 | 사용자가 끈 일정 | **여기서 안 한다** — DB 에 남은 사용자 토글이 이긴다 |
 * | 7 | 미분류 일정 | **수집** — 버리지 않고 `UNCATEGORIZED` 로 보여주는 게 정직하다 |
 *
 * ⚠️ 순서가 의미를 만든다. 종일이면서 8시간을 넘는 일정의 사유는 `ALL_DAY` 여야 한다 —
 *    사용자에게 설명할 때 "종일이라 뺐습니다"가 "8시간을 넘어 뺐습니다"보다 정확하다.
 */
export function classifyEvent(candidate: CalendarEventCandidate): FilterDecision {
    if (candidate.isAllDay) {
        return { excluded: true, reason: 'ALL_DAY' };
    }
    if (candidate.isWrittenByNfs) {
        return { excluded: true, reason: 'NFS_ORIGIN' };
    }
    if (candidate.isDeclinedByMe) {
        return { excluded: true, reason: 'DECLINED' };
    }
    if (eventMinutesOf(candidate) > MAX_EVENT_MINUTES) {
        return { excluded: true, reason: 'TOO_LONG' };
    }

    // 길이가 0 이하인 일정은 예산을 차지하지 않는다. 굳이 사유를 만들지 않고 통과시킨다 —
    // 예산 계산기가 길이 0 구간을 이미 무시한다
    return { excluded: false, reason: null };
}

/**
 * 태그 매핑 (정책 §4.3)
 *
 * 우선순위: **구글 이벤트 색상 → 미분류**
 *
 * 제목 키워드 규칙(2순위)은 넣지 않았다 —
 * *"회의록 정리"* 가 회의로 잡히는 오분류가 계속 나고, 정책에 규칙 목록이 확정돼 있지 않다.
 * 색상은 사용자가 직접 칠한 것이라 **명시적 의도**에 가장 가깝다.
 */
export function mapCategoryTag(
    colorId: string | null,
    colorToTag: ReadonlyMap<string, CategoryTag>,
): CategoryTag {
    if (colorId === null) {
        return 'UNCATEGORIZED';
    }

    const mapped = colorToTag.get(colorId);
    if (mapped === undefined) {
        return 'UNCATEGORIZED';
    }
    return mapped;
}
