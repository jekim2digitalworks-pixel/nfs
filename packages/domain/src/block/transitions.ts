import type { DateTime } from 'luxon';
import type { BlockStatus } from '../types/block';
import type { CategoryTag } from '../types/category-tag';
import { illegalBlockState } from '../errors';
import { workDateOf } from '../time/zone';
import {
    assertAlignedToGrid,
    assertCategoryTagPresent,
    assertValidBlockLength,
} from './validation';

/**
 * 블록 생명주기 (정책 §1.2 · §1.3)
 *
 * ```
 * READY ──start──▶ RUNNING ──pause──▶ PAUSED
 *                     │        ◀─resume─┘
 *                     └── 정산 ──▶ TimeLog (되돌릴 수 없다)
 * ```
 *
 * ⭐ **여기 있는 함수는 전부 순수 함수다.** 새 스냅샷을 돌려줄 뿐 저장하지 않는다.
 *    서비스는 결과를 받아 저장만 한다 — 상태 전이 '판단'을 서비스가 하면
 *    같은 판단이 API 와 배치 두 군데에 생기고, 언젠가 한쪽만 고쳐진다.
 *
 * ⭐ **'지금'을 스스로 만들지 않는다.** now 를 인자로 받는다.
 *    그래야 자정 경계와 일시정지 누적을 테스트에서 재현할 수 있다.
 */

/** 진행 중인 블록의 상태. DB 행이 아니라 계산에 필요한 값만 담는다 */
export interface ActiveBlockSnapshot {
    /** BigInt 를 도메인에 끌어들이지 않는다. 원장의 멱등성 키도 문자열이다 */
    activeBlockId: string;
    title: string;
    categoryTag: CategoryTag;
    blockStatus: BlockStatus;
    plannedStartTime: DateTime;
    plannedMinutes: number;
    /** 타이머를 처음 누른 시각. 예약만 하고 시작 안 했으면 null */
    actualStartTime: DateTime | null;
    /** 마지막 일시정지 시점까지의 누적. RUNNING 중인 구간은 여기 없다 */
    accumulatedFocusSeconds: number;
    /** RUNNING 으로 전이한 시각. RUNNING 이 아니면 null */
    lastResumedTime: DateTime | null;
    pauseCount: number;
    /** 자정 배치의 기준일 */
    workDate: string;
}

export interface CreateBlockCommand {
    activeBlockId: string;
    title: string;
    categoryTag: CategoryTag;
    plannedStartTime: DateTime;
    plannedMinutes: number;
    startImmediately: boolean;
}

/**
 * 블록을 만든다. 검증 순서는 API명세 §2 그대로다.
 *
 * ⚠️ **예산 초과 검증은 여기 없다.** 그건 다른 블록·캘린더를 읽어야 알 수 있어서
 *    순수 함수로 만들 수 없다. 서비스가 `assertBlockFitsInBudget` 을 이어서 부른다.
 */
export function createBlock(command: CreateBlockCommand, now: DateTime): ActiveBlockSnapshot {
    assertCategoryTagPresent(command.categoryTag);
    assertValidBlockLength(command.plannedMinutes);
    assertAlignedToGrid(command.plannedStartTime);

    // 제목을 비우면 태그명이 제목이 된다 (정책 §1.1).
    // 표시명은 화면이 갖고 있으므로 여기서는 빈 문자열로 두고 화면이 채운다 —
    // 서버가 한국어 표시명을 원장에 박으면 나중에 문구를 못 바꾼다.
    const title = command.title.trim();

    // work_date 는 **계획 시작 시각** 기준이다. 생성 시각이 아니다.
    // 23:50 에 내일 09:00 블록을 만들어도 그건 내일 자정 배치의 몫이다.
    const workDate = workDateOf(command.plannedStartTime);

    const created: ActiveBlockSnapshot = {
        activeBlockId: command.activeBlockId,
        title: title,
        categoryTag: command.categoryTag,
        blockStatus: 'READY',
        plannedStartTime: command.plannedStartTime,
        plannedMinutes: command.plannedMinutes,
        actualStartTime: null,
        accumulatedFocusSeconds: 0,
        lastResumedTime: null,
        pauseCount: 0,
        workDate: workDate,
    };

    if (!command.startImmediately) {
        return created;
    }
    return startBlock(created, now);
}

/** READY → RUNNING. 타이머를 처음 누른 순간 */
export function startBlock(block: ActiveBlockSnapshot, now: DateTime): ActiveBlockSnapshot {
    if (block.blockStatus !== 'READY') {
        throw illegalBlockState(block.blockStatus, 'RUNNING');
    }

    return {
        ...block,
        blockStatus: 'RUNNING',
        // 첫 시작 시각은 한 번만 찍힌다. 재개(resume)로는 바뀌지 않는다 —
        // 원장의 startTime 이 여기서 오기 때문이다
        actualStartTime: now,
        lastResumedTime: now,
    };
}

/**
 * RUNNING → PAUSED. **여기서 누적 집중 초를 확정한다.**
 *
 * 매초 DB 를 갱신하지 않는 이유(정책 §1.3): 타이머 앱이 초당 UPDATE 를 날리면
 * 커넥션과 인덱스 비용이 사용자 수에 비례해 터진다.
 * 상태 전이 시점에만 쓰면 하루에 몇 번이면 끝난다.
 */
export function pauseBlock(block: ActiveBlockSnapshot, now: DateTime): ActiveBlockSnapshot {
    if (block.blockStatus !== 'RUNNING') {
        throw illegalBlockState(block.blockStatus, 'PAUSED');
    }

    const runningSeconds = elapsedSecondsSinceResume(block, now);

    return {
        ...block,
        blockStatus: 'PAUSED',
        accumulatedFocusSeconds: block.accumulatedFocusSeconds + runningSeconds,
        lastResumedTime: null,
        pauseCount: block.pauseCount + 1,
    };
}

/**
 * PAUSED → RUNNING.
 *
 * 뽀모도로 휴식 5분도 이 상태를 지난다. 그래서 휴식 시간은 누적 집중 초에
 * 자연히 포함되지 않는다 — 따로 빼는 계산이 필요 없다 (N-019).
 */
export function resumeBlock(block: ActiveBlockSnapshot, now: DateTime): ActiveBlockSnapshot {
    if (block.blockStatus !== 'PAUSED') {
        throw illegalBlockState(block.blockStatus, 'RUNNING');
    }

    return {
        ...block,
        blockStatus: 'RUNNING',
        lastResumedTime: now,
    };
}

/**
 * 마지막 재개 이후 흐른 초. RUNNING 이 아니면 0.
 *
 * 음수를 돌려주지 않는다 — 서버 시각이 뒤로 갈 일은 없지만,
 * 저장된 lastResumedTime 이 미래인 데이터 사고가 나면 집중 시간이 음수가 되어
 * 통계가 조용히 망가진다.
 */
function elapsedSecondsSinceResume(block: ActiveBlockSnapshot, now: DateTime): number {
    if (block.blockStatus !== 'RUNNING' || block.lastResumedTime === null) {
        return 0;
    }

    const seconds = Math.floor(now.diff(block.lastResumedTime, 'seconds').seconds);

    if (seconds < 0) {
        return 0;
    }
    return seconds;
}

/**
 * 지금 이 순간의 집중 시간(초). (정책 §1.3)
 *
 * `누적 + (지금 − 마지막 재개)` — 뒷항은 RUNNING 일 때만 더한다.
 *
 * ⭐ **기준 시각은 항상 서버 시간이다.** 클라이언트 타이머는 표시 전용이고,
 *    브라우저 탭이 백그라운드로 가면 rAF 가 멈춰 클라 누적값이 뒤처진다.
 */
export function focusSecondsAt(block: ActiveBlockSnapshot, now: DateTime): number {
    return block.accumulatedFocusSeconds + elapsedSecondsSinceResume(block, now);
}

/** 통계와 원장이 쓰는 단위는 분이다. 초는 버린다 (올림하면 하루 합계가 부풀어 오른다) */
export function focusMinutesAt(block: ActiveBlockSnapshot, now: DateTime): number {
    return Math.floor(focusSecondsAt(block, now) / 60);
}

/** 계획한 종료 시각 */
export function plannedEndTimeOf(block: ActiveBlockSnapshot): DateTime {
    return block.plannedStartTime.plus({ minutes: block.plannedMinutes });
}

/**
 * 계획 시간을 채웠는가. (정책 §1.2 — 계획 시간 도달 시 NORMAL_COMPLETED)
 *
 * **벽시계가 아니라 집중 시간으로 판단한다.**
 * 30분 블록을 10분 쉬면서 하면 벽시계로는 30분이 지나도 집중은 20분이다.
 * 이 제품이 재는 것은 흐른 시간이 아니라 집중한 시간이다.
 */
export function hasCompletedPlannedFocus(block: ActiveBlockSnapshot, now: DateTime): boolean {
    return focusMinutesAt(block, now) >= block.plannedMinutes;
}
