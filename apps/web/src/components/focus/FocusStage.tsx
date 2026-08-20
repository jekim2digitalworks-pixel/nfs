'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORY_TAG_LABELS, pomodoroCyclesOf, type CategoryTag } from '@nfs/domain';
import { formatKoreanDuration } from '@/lib/format';
import { getJson, postJson } from '@/lib/api';
import { useServerClock } from '@/hooks/useServerClock';
import { useBlockTimer } from '@/hooks/useBlockTimer';
import { parseAppDateTime } from '@nfs/domain/time';

/**
 * S-04 집중 (U-05 · 시안 C)
 *
 * **크롬이 없다. 화면에 오브젝트가 하나뿐이다.**
 * 나가는 길은 좌상단 닫기뿐이고, 하단 탭도 숨는다 (화면정의서 §S-04).
 *
 * ⭐ 여기 보이는 숫자는 전부 **표시 전용**이다. 진실은 서버에 있다.
 *    - 경과는 `useServerClock` 오프셋 위에서 매 틱 다시 계산한다 (누적하지 않는다)
 *    - 일시정지·완료는 서버가 판정하고, 응답으로 기준 사진을 새로 받는다
 *    - 앱을 닫아도 타이머는 서버에서 계속 흐른다. 재진입하면 서버 값으로 맞춰진다
 */

export interface FocusBlockView {
    activeBlockId: string;
    title: string;
    categoryTag: CategoryTag;
    blockStatus: 'READY' | 'RUNNING' | 'PAUSED';
    plannedStartTime: string;
    plannedMinutes: number;
    focusSeconds: number;
    pauseCount: number;
    serverTime: string;
}

interface FocusStageProps {
    block: FocusBlockView;
    /** 상단 좌측에 띄우는 오늘 남은 예산(분) */
    remainingBudgetMinutes: number;
}

interface SettledResult {
    actualFocusMinutes: number;
}

/** 다이얼 반지름과 둘레 (디자인 §6 — r=105, stroke 7) */
const DIAL_RADIUS = 105;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;

/** `07:24` — 분:초. 시간 단위로 올리지 않는다. 블록은 최대 180분이다 */
function formatClock(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function FocusStage({ block, remainingBudgetMinutes }: FocusStageProps) {
    const router = useRouter();

    // 서버가 준 '사진'. 상태 전이 응답이 올 때마다 통째로 갈아 끼운다
    const [snapshot, setSnapshot] = useState<FocusBlockView>(block);
    const [isBusy, setIsBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [settled, setSettled] = useState<SettledResult | null>(null);

    /** 화면이 돌아왔을 때 서버에게 다시 묻는다 — 숨겨진 동안 잰 값은 거짓이다 */
    const resyncFromServer = useCallback(
        function resync() {
            getJson<FocusBlockView | null>('/api/blocks/current').then(function apply(result) {
                // 재동기화 실패는 화면을 막지 않는다. 다음 기회에 다시 맞춘다
                if (!result.ok || result.data === null) {
                    return;
                }

                // 그 사이 다른 기기에서 완료됐을 수 있다. 그러면 하루로 돌려보낸다
                if (result.data.activeBlockId !== snapshot.activeBlockId) {
                    router.replace('/day');
                    return;
                }
                setSnapshot(result.data);
            });
        },
        [snapshot.activeBlockId, router],
    );

    const clock = useServerClock(snapshot.serverTime, resyncFromServer);

    const baseServerMillis = parseAppDateTime(snapshot.serverTime).toMillis();
    const focusSeconds = useBlockTimer({
        clock: clock,
        baseFocusSeconds: snapshot.focusSeconds,
        baseServerMillis: baseServerMillis,
        isRunning: snapshot.blockStatus === 'RUNNING',
    });

    const plannedSeconds = snapshot.plannedMinutes * 60;
    const isOvertime = focusSeconds >= plannedSeconds;

    let progressRatio = focusSeconds / plannedSeconds;
    if (progressRatio > 1) {
        progressRatio = 1;
    }
    if (progressRatio < 0) {
        progressRatio = 0;
    }

    const dashOffset = DIAL_CIRCUMFERENCE * (1 - progressRatio);

    /** 계획을 채우면 남은 시간 대신 **초과 시간**을 센다 (화면정의서 §S-04) */
    let dialText: string;
    let dialCaption: string;

    if (isOvertime) {
        dialText = `+${formatClock(focusSeconds - plannedSeconds)}`;
        dialCaption = '계획을 채웠습니다';
    } else {
        dialText = formatClock(plannedSeconds - focusSeconds);
        dialCaption = '남은 집중 시간';
    }

    const totalCycles = pomodoroCyclesOf(snapshot.plannedMinutes);
    let currentCycle = Math.floor(focusSeconds / 60 / 30) + 1;
    if (currentCycle > totalCycles) {
        currentCycle = totalCycles;
    }

    const plannedStart = parseAppDateTime(snapshot.plannedStartTime);
    const plannedEnd = plannedStart.plus({ minutes: snapshot.plannedMinutes });

    async function callAction(action: 'start' | 'pause' | 'resume' | 'complete') {
        setIsBusy(true);
        setErrorMessage(null);

        try {
            const result = await postJson<FocusBlockView & { actualFocusMinutes?: number }>(
                `/api/blocks/${snapshot.activeBlockId}/${action}`,
            );

            if (!result.ok) {
                setErrorMessage(result.message);
                return;
            }

            if (action === 'complete') {
                // 정산은 되돌릴 수 없다. 결과를 보여주고 사용자가 다음을 고르게 한다
                let recordedMinutes = 0;
                if (typeof result.data.actualFocusMinutes === 'number') {
                    recordedMinutes = result.data.actualFocusMinutes;
                }
                setSettled({ actualFocusMinutes: recordedMinutes });
                return;
            }
            setSnapshot(result.data);
        } finally {
            setIsBusy(false);
        }
    }

    if (settled !== null) {
        return (
            <section className="focus-done" aria-live="polite">
                <p className="focus-done-cap">기록했습니다</p>
                <p className="focus-done-num num">
                    {CATEGORY_TAG_LABELS[snapshot.categoryTag]}에{' '}
                    {formatKoreanDuration(settled.actualFocusMinutes)}
                </p>
                <p className="focus-done-hint">
                    이 기록은 원장에 남았습니다. 되돌릴 수 없습니다
                </p>

                <div className="focus-done-acts">
                    <button
                        className="btn btn--primary"
                        type="button"
                        onClick={() => router.push('/day?new=1')}
                    >
                        계속 이어서
                    </button>
                    <button className="btn btn--secondary" type="button" onClick={() => router.push('/day')}>
                        오늘로 돌아가기
                    </button>
                </div>
            </section>
        );
    }

    return (
        <>
            <div className="focus-top">
                <span className="focus-left-cap">
                    오늘 남은 시간{' '}
                    <b className="num">{formatKoreanDuration(remainingBudgetMinutes)}</b>
                </span>
                <button
                    className="focus-close"
                    type="button"
                    aria-label="닫고 오늘로"
                    onClick={() => router.push('/day')}
                >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                        <path
                            d="M2.5 5.5 7.5 10l5-4.5"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>
            </div>

            <main className="focus-stage" data-tag={snapshot.categoryTag}>
                <span className="focus-tag">
                    <i />
                    {CATEGORY_TAG_LABELS[snapshot.categoryTag]}
                </span>
                <h1 className="focus-title">
                    {snapshot.title.length > 0
                        ? snapshot.title
                        : CATEGORY_TAG_LABELS[snapshot.categoryTag]}
                </h1>
                <p className="focus-meta num">
                    {plannedStart.toFormat('HH:mm')} – {plannedEnd.toFormat('HH:mm')} ·{' '}
                    {snapshot.plannedMinutes}분 블록
                </p>

                <div className={isOvertime ? 'dial dial--over' : 'dial'}>
                    <svg
                        viewBox="0 0 240 240"
                        role="img"
                        aria-label={`${snapshot.plannedMinutes}분 중 ${Math.floor(focusSeconds / 60)}분 집중했습니다`}
                    >
                        <defs>
                            <filter id="dial-soft" x="-60%" y="-60%" width="220%" height="220%">
                                <feGaussianBlur stdDeviation="7" />
                            </filter>
                        </defs>
                        {/* 호흡하는 헤일로. 정지 중에는 숨을 멈춘다 */}
                        <circle
                            className="dial-halo"
                            cx="120"
                            cy="120"
                            r={DIAL_RADIUS}
                            fill="none"
                            stroke="var(--c)"
                            strokeWidth="2"
                            opacity=".5"
                            filter="url(#dial-soft)"
                        />
                        <g transform="rotate(-90 120 120)" fill="none">
                            <circle
                                cx="120"
                                cy="120"
                                r={DIAL_RADIUS}
                                stroke="rgba(255,255,255,.07)"
                                strokeWidth="7"
                            />
                            <circle
                                className="dial-arc"
                                cx="120"
                                cy="120"
                                r={DIAL_RADIUS}
                                stroke="var(--c)"
                                strokeWidth="7"
                                strokeLinecap="round"
                                strokeDasharray={DIAL_CIRCUMFERENCE}
                                strokeDashoffset={dashOffset}
                            />
                        </g>
                    </svg>

                    <div className="dial-face">
                        {/* ⚠️ 매초 읽어주면 소음이다. 값 자체는 조용히 둔다 (퍼블 §3 접근성) */}
                        <p className="dial-timer num" aria-live="off">
                            {dialText}
                        </p>
                        <p className="dial-cap">{dialCaption}</p>
                    </div>
                </div>

                <div className="cycles" aria-label={`뽀모도로 ${currentCycle} / ${totalCycles}`}>
                    {Array.from({ length: totalCycles }).map(function renderCycle(_unused, index) {
                        const isDone = index < currentCycle;

                        return <i key={index} className={isDone ? 'on' : undefined} />;
                    })}
                    <span className="num">
                        뽀모도로 {currentCycle} / {totalCycles}
                    </span>
                </div>

                {snapshot.blockStatus === 'PAUSED' ? (
                    <p className="focus-state" aria-live="polite">
                        일시 정지됨 · {snapshot.pauseCount}번째
                    </p>
                ) : null}
            </main>

            <div className="focus-controls">
                {errorMessage !== null ? (
                    <p className="focus-error" role="alert">
                        {errorMessage}
                    </p>
                ) : null}

                <div className="focus-buttons">
                    {snapshot.blockStatus === 'RUNNING' ? (
                        <button
                            className="btn btn--secondary"
                            type="button"
                            disabled={isBusy}
                            onClick={() => callAction('pause')}
                        >
                            <svg width="14" height="15" viewBox="0 0 14 15" fill="currentColor" aria-hidden="true">
                                <rect x="1" y="1" width="4.4" height="13" rx="1.7" />
                                <rect x="8.6" y="1" width="4.4" height="13" rx="1.7" />
                            </svg>
                            일시 정지
                        </button>
                    ) : null}

                    {snapshot.blockStatus === 'PAUSED' ? (
                        <button
                            className="btn btn--secondary"
                            type="button"
                            disabled={isBusy}
                            onClick={() => callAction('resume')}
                        >
                            이어서 하기
                        </button>
                    ) : null}

                    {snapshot.blockStatus === 'READY' ? (
                        <button
                            className="btn btn--secondary"
                            type="button"
                            disabled={isBusy}
                            onClick={() => callAction('start')}
                        >
                            시작하기
                        </button>
                    ) : null}

                    <button
                        className="btn btn--primary"
                        type="button"
                        disabled={isBusy}
                        onClick={() => callAction('complete')}
                    >
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                            <path
                                d="M2 8.2 5.8 12 13 3.4"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                        완료
                    </button>
                </div>

                {/* 캘린더 쓰기는 Phase 2 (B-15 🅿️). 아직 없는 기능을 체크박스로 약속하지 않는다 */}
                <p className="focus-after">
                    완료하면 <b>{CATEGORY_TAG_LABELS[snapshot.categoryTag]}</b> 태그로 기록합니다
                </p>
            </div>
        </>
    );
}
