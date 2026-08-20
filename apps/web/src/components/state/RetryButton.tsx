'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 재시도 버튼 (U-07 · 시안 G)
 *
 * ⭐ **여기서만 클라이언트가 된다.** 실패 카드 자체는 서버 컴포넌트다 —
 *    실패했다는 사실은 서버가 알고, 다시 부르는 동작만 브라우저가 한다.
 *
 * `router.refresh()` 를 쓰는 이유:
 *   화면 데이터를 서버 컴포넌트가 직접 조회하므로(아키텍처 §3), 다시 그리려면
 *   서버에 다시 물어야 한다. `location.reload()` 는 폰트·번들까지 다시 받아
 *   실패한 사람을 더 오래 기다리게 한다.
 *
 * `useTransition` 을 쓰는 이유:
 *   `refresh()` 는 프라미스를 돌려주지 않는다. 전환이 끝나는 시점을 알 길이
 *   이것뿐이라, 없으면 버튼이 즉시 풀려 연타로 서버를 두드리게 된다.
 */

interface RetryButtonProps {
    label: string;
}

export function RetryButton({ label }: RetryButtonProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    function retry() {
        startTransition(function refreshFromServer() {
            router.refresh();
        });
    }

    let text = label;
    if (isPending) {
        text = '불러오는 중…';
    }

    return (
        <button className="retry" type="button" onClick={retry} disabled={isPending}>
            <svg
                width="13"
                height="13"
                viewBox="0 0 17 17"
                fill="none"
                aria-hidden="true"
                className={isPending ? 'spin' : undefined}
            >
                <path
                    d="M15 8.5a6.5 6.5 0 1 1-1.9-4.6M15 1.6v3.9h-3.9"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
            {text}
        </button>
    );
}
