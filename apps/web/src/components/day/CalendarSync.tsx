'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/api';

/**
 * 캘린더 동기화 — 헤더 버튼 · 실패 배너 (B-11 · U-07 · 시안 G)
 *
 * ⭐ **왜 컨텍스트인가.** 시안 G 는 실패를 **두 자리**에서 말한다 —
 *    헤더 아이콘의 점(여기 문제가 있다)과 예산 카드 아래 배너(무엇이·무엇을 할지).
 *    둘은 DOM 상 떨어져 있는데 같은 사실을 본다. 상태를 두 벌 두면 반드시 어긋난다.
 *
 * ⭐ **에러는 화면을 덮지 않는다** (화면정의서 §0.4).
 *    모달도 토스트도 아니고, 실패한 조각(캘린더) 옆에서만 말한다.
 *
 * ⚠️ 성공은 배너를 남기지 않는다. 성공했다는 사실은 **미터가 바뀌는 것으로** 이미 보인다 —
 *    거기에 배너까지 띄우면 사용자가 지워야 할 물건이 하나 늘어난다.
 */

type SyncPhase =
    /** 아직 아무것도 안 눌렀다 */
    | 'IDLE'
    /** 요청 중 */
    | 'SYNCING'
    /** 방금 읽어왔다 (짧은 안내만) */
    | 'DONE'
    /** 토큰 만료·구글 장애. 점 + 배너가 남는다 */
    | 'FAILED';

interface CalendarSyncState {
    phase: SyncPhase;
    /** 성공했을 때 짧게 보여줄 한 줄. 실패는 배너가 맡는다 */
    doneMessage: string | null;
    /** 마지막으로 실제 읽어온 시각 'HH:mm'. 서버가 준다 */
    lastSyncedLabel: string | null;
    sync: () => void;
}

const CalendarSyncContext = createContext<CalendarSyncState | null>(null);

function useCalendarSync(): CalendarSyncState {
    const state = useContext(CalendarSyncContext);

    if (state === null) {
        // 개발 중에만 나는 실수다. 조용히 아무것도 안 그리면 원인을 찾는 데 한참 걸린다
        throw new Error('CalendarSyncProvider 안에서만 쓸 수 있습니다');
    }
    return state;
}

interface SyncResponse {
    status: 'SYNCED' | 'NOT_CONNECTED' | 'FAILED';
    importedCount: number;
    excludedCount: number;
}

/**
 * 성공 문구를 만든다.
 *
 * 왜 몇 개가 빠졌는지 숫자로 말한다 — 말하지 않으면 "왜 다 안 들어왔지"가 된다.
 */
function doneMessageOf(result: SyncResponse): string {
    if (result.importedCount === 0) {
        return '이번 주 일정이 없습니다';
    }
    if (result.excludedCount > 0) {
        return `${result.importedCount}개를 불러왔습니다 (${result.excludedCount}개는 통계에서 제외)`;
    }
    return `${result.importedCount}개를 불러왔습니다`;
}

interface ProviderProps {
    lastSyncedLabel: string | null;
    children: ReactNode;
}

export function CalendarSyncProvider({ lastSyncedLabel, children }: ProviderProps) {
    const router = useRouter();
    const [phase, setPhase] = useState<SyncPhase>('IDLE');
    const [doneMessage, setDoneMessage] = useState<string | null>(null);

    async function runSync() {
        setPhase('SYNCING');
        setDoneMessage(null);

        const result = await postJson<SyncResponse>('/api/calendar/sync');

        // 봉투가 실패한 경우(네트워크·5xx)도 사용자 입장에서는 "못 불러왔다"로 같다
        if (!result.ok) {
            setPhase('FAILED');
            return;
        }

        if (result.data.status !== 'SYNCED') {
            setPhase('FAILED');
            return;
        }

        setPhase('DONE');
        setDoneMessage(doneMessageOf(result.data));
        // 예산 미터와 타임라인을 서버가 다시 그리게 한다
        router.refresh();
    }

    function sync() {
        void runSync();
    }

    const state: CalendarSyncState = {
        phase: phase,
        doneMessage: doneMessage,
        lastSyncedLabel: lastSyncedLabel,
        sync: sync,
    };

    // 래퍼 DOM 을 만들지 않는다. 헤더와 미터 사이에 빈 div 가 끼면 여백이 어긋난다
    return <CalendarSyncContext.Provider value={state}>{children}</CalendarSyncContext.Provider>;
}

/** 헤더 우측 아이콘. 실패하면 점이 붙는다 (화면정의서 S-03) */
export function CalendarSyncButton() {
    const { phase, doneMessage, sync } = useCalendarSync();
    const isSyncing = phase === 'SYNCING';

    let label = '캘린더 다시 불러오기';
    if (phase === 'FAILED') {
        label = '캘린더를 불러오지 못했습니다. 다시 시도';
    }

    return (
        <div className="cal-sync">
            <button
                className="icon-btn"
                type="button"
                aria-label={label}
                disabled={isSyncing}
                onClick={sync}
            >
                <svg
                    width="17"
                    height="17"
                    viewBox="0 0 17 17"
                    fill="none"
                    aria-hidden="true"
                    className={isSyncing ? 'spin' : undefined}
                >
                    <path
                        d="M15 8.5a6.5 6.5 0 1 1-1.9-4.6M15 1.6v3.9h-3.9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                {phase === 'FAILED' ? <span className="err-dot" aria-hidden="true" /> : null}
            </button>

            {/* 성공 안내만 여기에. 실패는 아래 배너가 자세히 말한다 */}
            {doneMessage !== null ? (
                <p className="cal-sync-msg" role="status">
                    {doneMessage}
                </p>
            ) : null}
        </div>
    );
}

/**
 * 예산 카드 아래 인라인 배너 (시안 G "부분 실패")
 *
 * ⭐ **아는 것은 남긴다.** 캘린더를 못 읽었어도 내 블록은 안다 —
 *    그래서 미터와 타임라인은 그대로 두고, 모른다는 사실만 여기서 말한다.
 */
export function CalendarSyncBanner() {
    const { phase, lastSyncedLabel, sync } = useCalendarSync();

    if (phase !== 'FAILED') {
        return null;
    }

    let detail = '아직 이번 주 일정을 한 번도 불러오지 못했습니다';
    if (lastSyncedLabel !== null) {
        detail = `지난번에 읽은 일정으로 보여주고 있습니다 · ${lastSyncedLabel}`;
    }

    return (
        <section className="inline-err" role="alert">
            <div className="inline-err__txt">
                <b>캘린더를 불러오지 못했어요</b>
                <span>{detail}</span>
            </div>

            <button className="retry" type="button" onClick={sync}>
                <svg width="12" height="12" viewBox="0 0 17 17" fill="none" aria-hidden="true">
                    <path
                        d="M15 8.5a6.5 6.5 0 1 1-1.9-4.6M15 1.6v3.9h-3.9"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                다시
            </button>
        </section>
    );
}
