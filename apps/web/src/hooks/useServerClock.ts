'use client';

import { useCallback, useEffect, useRef } from 'react';
import { parseAppDateTime } from '@nfs/domain/time';

/**
 * 서버 시간 오프셋 (F-01 · 퍼블 §4.2) ⭐⭐
 *
 * **이 프로젝트에서 가장 많이 틀리는 부분이다.**
 *
 * 원칙 네 가지:
 *   1. 클라이언트 타이머는 **표시 전용**이다. 정산은 서버가 한다
 *   2. 경과 시간을 `setInterval` 로 **누적하지 않는다** —
 *      탭이 백그라운드로 가면 브라우저가 타이머를 조인다. 값이 조용히 뒤처진다
 *   3. 서버가 준 기준 시각과 로컬 시각의 차이(offset)를 저장하고,
 *      매 틱마다 `Date.now() + offset` 으로 '지금'을 **다시 계산한다**
 *   4. 화면이 돌아오면(`visibilitychange`) 즉시 서버와 재동기화한다
 *
 * 3번이 핵심이다. 누적이 아니라 매번 벽시계를 다시 읽으므로
 * 틱이 몇 개 빠져도 다음 틱에서 정확한 값으로 돌아온다.
 *
 * ⚠️ 사용자의 PC 시계가 5분 틀어져 있어도 이 오프셋이 그걸 흡수한다.
 *    `Date.now()` 를 그대로 믿으면 남은 시간이 처음부터 틀린 값으로 시작한다.
 */

export interface ServerClock {
    /** 서버 기준 '지금'(epoch millis). 렌더마다 호출해도 싸다 */
    currentServerMillis: () => number;
    /** 서버가 준 로컬 시각 문자열로 오프셋을 다시 맞춘다 */
    syncWithServer: (serverLocalTime: string) => void;
}

function toEpochMillis(serverLocalTime: string): number {
    // ⚠️ `new Date('2026-08-20T14:00:00')` 은 브라우저 로컬 존으로 해석된다.
    //    한국 밖에서 열면 9시간이 통째로 어긋난다. 존을 아는 Luxon 만 쓴다
    return parseAppDateTime(serverLocalTime).toMillis();
}

/**
 * @param initialServerTime 서버가 내려준 기준 시각 (앱 타임존 로컬 문자열)
 * @param onVisible         화면이 다시 보일 때 부를 재동기화 콜백.
 *                          **데이터를 가져오는 일은 화면이 한다** — 이 훅은 시계만 본다
 */
export function useServerClock(initialServerTime: string, onVisible?: () => void): ServerClock {
    // 렌더와 무관한 값이라 state 가 아니라 ref 에 둔다.
    // state 로 두면 오프셋이 바뀔 때마다 트리 전체가 다시 그려진다.
    //
    // ⚠️ 초기값을 렌더 중에 `Date.now()` 로 계산하지 않는다.
    //    렌더는 순수해야 하고, 서버 렌더와 하이드레이션에서 값이 달라져 경고가 난다.
    //    아래 effect 가 마운트 직후 채운다 — 그전까지는 오프셋 0(로컬 시계)이다.
    const serverOffsetMillis = useRef<number | null>(null);

    const syncWithServer = useCallback(function sync(serverLocalTime: string) {
        serverOffsetMillis.current = toEpochMillis(serverLocalTime) - Date.now();
    }, []);

    const currentServerMillis = useCallback(function currentMillis() {
        if (serverOffsetMillis.current === null) {
            return Date.now();
        }
        return Date.now() + serverOffsetMillis.current;
    }, []);

    // 서버 시각이 새로 내려오면(재렌더·재진입) 오프셋을 갱신한다
    useEffect(
        function resyncOnNewServerTime() {
            syncWithServer(initialServerTime);
        },
        [initialServerTime, syncWithServer],
    );

    useEffect(
        function resyncOnVisible() {
            if (onVisible === undefined) {
                return;
            }

            function handleVisibilityChange() {
                if (document.hidden) {
                    return;
                }
                // 숨겨진 동안 잰 값은 거짓이다. 돌아오면 서버에게 다시 묻는다
                if (onVisible !== undefined) {
                    onVisible();
                }
            }
            document.addEventListener('visibilitychange', handleVisibilityChange);

            // ⚠️ cleanup 을 반드시 돌려준다. StrictMode 가 effect 를 두 번 실행해도
            //    리스너가 중복 등록되지 않는다 (퍼블 §4.2)
            return function cleanup() {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            };
        },
        [onVisible],
    );

    return {
        currentServerMillis: currentServerMillis,
        syncWithServer: syncWithServer,
    };
}
