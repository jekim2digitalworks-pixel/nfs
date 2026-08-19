import type { DateTime } from 'luxon';
import type { CompletionType } from '../types/block';
import type { CategoryTag } from '../types/category-tag';
import { workDateOf } from '../time/zone';
import { focusMinutesAt, type ActiveBlockSnapshot } from './transitions';

/**
 * 정산 — 가변 작업 영역(`ActiveBlock`)이 불변 원장(`TimeLog`)으로 넘어가는 지점.
 *
 * **되돌릴 수 없다.** 그래서 여기서 계산한 값이 영원히 남는다.
 * 이 파일이 하는 일은 "무엇을 기록할지" 정하는 것뿐이고,
 * 실제 INSERT/DELETE 순서와 멱등성은 서비스(B-06)가 맡는다.
 */

/** 무엇이 정산을 일으켰는가. 완료 유형은 이 방아쇠에서 파생된다 */
export type SettlementTrigger =
    /** 사용자가 완료 버튼을 눌렀다 (계획을 채웠는지는 여기서 판단한다) */
    | 'USER_COMPLETE'
    /** 사용자가 블록을 지웠다 */
    | 'USER_ABANDON'
    /** 자정 배치가 미완료 블록을 강제로 닫았다 */
    | 'MIDNIGHT_BATCH';

/** 원장에 들어갈 한 줄. 겹침 차감은 예산 계산기가 채운다 */
export interface TimeLogDraft {
    sourceType: 'NFS_BLOCK';
    /** 멱등성 키 — 같은 블록을 두 번 정산해도 DB 가 막는다 */
    sourceReferenceKey: string;
    title: string;
    categoryTag: CategoryTag;
    /** 통계 집계 기준일 = **시작한 날** (정책 §2.3) */
    statDate: string;
    startTime: DateTime;
    endTime: DateTime;
    plannedMinutes: number;
    actualFocusMinutes: number;
    completionType: CompletionType;
    pauseCount: number;
}

/**
 * 완료 유형을 정한다. (정책 §1.2)
 *
 * `AUTO_SETTLED` 를 따로 두는 이유는 **신뢰도 때문**이다.
 * 사용자가 노트북을 덮고 잠들었는지, 진짜 그때까지 집중했는지 우리는 모른다.
 * 나중에 "자동 정산분 제외" 같은 필터를 걸 수 있게 출처를 남겨둔다.
 */
function completionTypeOf(
    block: ActiveBlockSnapshot,
    now: DateTime,
    trigger: SettlementTrigger,
): CompletionType {
    if (trigger === 'USER_ABANDON') {
        return 'ABANDONED';
    }
    if (trigger === 'MIDNIGHT_BATCH') {
        return 'AUTO_SETTLED';
    }

    // USER_COMPLETE — 계획을 채웠으면 정상 완료, 못 채웠으면 조기 완료.
    // 이 구분이 "계획한 3시간 중 조기 종료가 몇 번이었나"라는 회고 신호가 된다.
    if (focusMinutesAt(block, now) >= block.plannedMinutes) {
        return 'NORMAL_COMPLETED';
    }
    return 'EARLY_FINISHED';
}

/**
 * 원장에 남길 시작 시각.
 *
 * 타이머를 한 번도 누르지 않았으면 **계획 시작 시각**을 쓴다 (테스트계획 #19).
 * null 로 두면 통계가 이 행을 어디에 놓을지 몰라 조용히 빠진다.
 */
function settledStartTimeOf(block: ActiveBlockSnapshot): DateTime {
    if (block.actualStartTime !== null) {
        return block.actualStartTime;
    }
    return block.plannedStartTime;
}

/**
 * 원장에 남길 종료 시각.
 *
 * 세 가지를 동시에 만족해야 한다:
 *   1. 계획한 길이를 넘지 않는다 — 예산에서 계획보다 많은 자리를 차지하면 안 된다
 *   2. 시작보다 이를 수 없다 — 시작 전에 지운 블록은 길이 0 이 된다
 *   3. 그 사이에서는 실제로 흐른 시각(now)을 쓴다 — 조기 완료를 정직하게 기록한다
 *
 * ⚠️ 1번이 자정 배치에서 특히 중요하다.
 *    00:05 에 도는 배치가 어제 22:00 블록을 `now` 로 닫으면
 *    1시간짜리 블록이 2시간 5분으로 늘어나고 날짜까지 넘어간다.
 *
 * ⭐ **상한은 `계획 종료`가 아니라 `실제 시작 + 계획 길이`다.**
 *    계획 종료로 재면, 14:00 블록을 16:13 에 시작한 사용자의 기록이 통째로 깨진다 —
 *    상한(15:00)이 시작(16:13)보다 앞서 **구간 길이가 음수**가 된다.
 *    실제로 API 로 재현했다: 60분 블록에 집중 −74분이 기록됐다.
 *    (단위 테스트가 못 잡은 이유: 전부 계획 시각과 시작 시각을 같게 두고 있었다)
 *
 *    2번은 마지막에 적용한다. "시작보다 이를 수 없다"가 최종 불변식이기 때문이다.
 */
function settledEndTimeOf(
    block: ActiveBlockSnapshot,
    now: DateTime,
    startTime: DateTime,
): DateTime {
    const lengthCap = startTime.plus({ minutes: block.plannedMinutes });

    let endTime = now;

    if (endTime > lengthCap) {
        endTime = lengthCap;
    }
    if (endTime < startTime) {
        endTime = startTime;
    }
    return endTime;
}

/**
 * 원장에 남길 집중 분. ⭐ **기록 구간의 길이를 넘을 수 없다.**
 *
 * 왜 상한이 필요한가 (실제로 재현한 버그):
 *   사용자가 22:00 에 60분 블록을 시작하고 노트북을 덮은 채 잤다.
 *   블록은 RUNNING 인 채로 남고, 00:05 에 도는 자정 배치가 정산한다.
 *   `누적 + (now − lastResumed)` 를 그대로 쓰면 **125분**이 나온다 —
 *   60분짜리 블록이 2시간 넘게 집중한 것으로 원장에 박힌다.
 *
 *   종료 시각은 이미 계획 종료로 캡되어 구간은 60분인데 집중만 125분이 되어
 *   **"집중 시간 > 그 시간에 실재한 구간"** 이라는 모순이 통계에 남는다.
 *   자동 정산분이 통계를 부풀리는 가장 흔한 경로다.
 *
 * 그래서 불변식을 코드로 강제한다: `actualFocusMinutes ≤ endTime − startTime`.
 */
function settledFocusMinutesOf(
    block: ActiveBlockSnapshot,
    now: DateTime,
    startTime: DateTime,
    endTime: DateTime,
): number {
    const measuredMinutes = focusMinutesAt(block, now);

    // 구간 길이가 음수가 되는 상황은 이제 없지만(settledEndTimeOf 가 막는다),
    // 이 값이 원장에 그대로 박히므로 0 아래로는 내려가지 않게 한 겹 더 둔다.
    // 음수 집중 시간은 통계 합계를 조용히 갉아먹는다.
    const intervalMinutes = Math.max(0, Math.floor(endTime.diff(startTime, 'minutes').minutes));

    if (measuredMinutes > intervalMinutes) {
        return intervalMinutes;
    }
    if (measuredMinutes < 0) {
        return 0;
    }
    return measuredMinutes;
}

/**
 * 정산할 값을 계산한다. 저장은 하지 않는다.
 *
 * 집중 시간은 **누적된 실측값**이다. 벽시계 길이가 아니다 —
 * 일시정지한 구간과 뽀모도로 휴식은 여기 포함되지 않는다 (N-019).
 */
export function settleBlock(
    block: ActiveBlockSnapshot,
    now: DateTime,
    trigger: SettlementTrigger,
): TimeLogDraft {
    const startTime = settledStartTimeOf(block);
    const endTime = settledEndTimeOf(block, now, startTime);
    const actualFocusMinutes = settledFocusMinutesOf(block, now, startTime, endTime);

    // 제목이 비어 있으면 원장에도 비어서 들어간다.
    // 화면이 태그명으로 대체해 보여준다 — 서버가 한국어를 원장에 박지 않는다.
    return {
        sourceType: 'NFS_BLOCK',
        sourceReferenceKey: block.activeBlockId,
        title: block.title,
        categoryTag: block.categoryTag,
        // 통계 귀속은 **시작한 날** 하나뿐이다. 자정을 넘어도 쪼개지 않는다 (정책 §2.3).
        // 예산은 날짜별로 분할 청구하므로 두 기준이 어긋나지만, 각 기능이 목적에 최적화된 결과다.
        statDate: workDateOf(startTime),
        startTime: startTime,
        endTime: endTime,
        plannedMinutes: block.plannedMinutes,
        actualFocusMinutes: actualFocusMinutes,
        completionType: completionTypeOf(block, now, trigger),
        pauseCount: block.pauseCount,
    };
}
