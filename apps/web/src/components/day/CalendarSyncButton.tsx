'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/api';

/**
 * 캘린더 다시 불러오기 (B-11 · 화면정의서 S-03 헤더)
 *
 * ⭐ 결과를 **문구로 구분해서** 말한다.
 *   "실패했습니다" 하나로 뭉뚱그리면 사용자는 무엇을 해야 할지 모른다 —
 *   연동을 안 한 사람은 연동하러 가야 하고, 토큰이 만료된 사람은 다시 로그인해야 한다.
 *
 * ⚠️ 동기화 자체는 서버가 한다. 이 버튼은 **부르고 결과를 말할 뿐이다.**
 */

interface SyncResult {
    status: 'SYNCED' | 'NOT_CONNECTED' | 'FAILED';
    importedCount: number;
    excludedCount: number;
}

function messageOf(result: SyncResult): string {
    if (result.status === 'NOT_CONNECTED') {
        return '구글 캘린더가 연결되어 있지 않습니다';
    }
    if (result.status === 'FAILED') {
        return '캘린더를 불러오지 못했어요. 다시 로그인해 주세요';
    }
    if (result.importedCount === 0) {
        return '이번 주 일정이 없습니다';
    }
    if (result.excludedCount > 0) {
        // 왜 몇 개가 빠졌는지 숫자로 말한다. 말하지 않으면 "왜 다 안 들어왔지"가 된다
        return `${result.importedCount}개를 불러왔습니다 (${result.excludedCount}개는 통계에서 제외)`;
    }
    return `${result.importedCount}개를 불러왔습니다`;
}

export function CalendarSyncButton() {
    const router = useRouter();
    const [isSyncing, setIsSyncing] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    async function sync() {
        setIsSyncing(true);
        setMessage(null);

        try {
            const result = await postJson<SyncResult>('/api/calendar/sync');

            if (!result.ok) {
                setMessage(result.message);
                return;
            }

            setMessage(messageOf(result.data));

            if (result.data.status === 'SYNCED') {
                // 예산 미터와 타임라인을 서버가 다시 그리게 한다
                router.refresh();
            }
        } finally {
            setIsSyncing(false);
        }
    }

    return (
        <div className="cal-sync">
            <button
                className="icon-btn"
                type="button"
                aria-label="캘린더 다시 불러오기"
                disabled={isSyncing}
                onClick={sync}
            >
                <svg
                    width="17"
                    height="17"
                    viewBox="0 0 17 17"
                    fill="none"
                    aria-hidden="true"
                    className={isSyncing ? 'cal-sync-spin' : undefined}
                >
                    <path
                        d="M15 8.5a6.5 6.5 0 1 1-1.9-4.6M15 1.6v3.9h-3.9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {message !== null ? (
                <p className="cal-sync-msg" role="status">
                    {message}
                </p>
            ) : null}
        </div>
    );
}
