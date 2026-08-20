'use client';

import { useEffect, useState } from 'react';
import type { ServerClock } from './useServerClock';

/**
 * 표시 전용 타이머 (F-01 · 퍼블 §4.2) ⭐
 *
 * 서버는 "기준 시각(`serverTime`)에 집중 초가 얼마였다"는 **한 장의 사진**을 준다.
 * 이 훅은 그 사진에 흐른 시간을 더해 화면에 보여줄 뿐이다.
 *
 * ⭐ **누적하지 않는다.** 매 틱마다
 *    `기준 집중초 + (지금 − 기준 시각)` 을 처음부터 다시 계산한다.
 *    그래서 탭이 백그라운드로 가 틱을 30개 놓쳐도, 돌아온 첫 틱에서 정확한 값이 나온다.
 *    (`focusSeconds += 1` 로 짰다면 놓친 30초가 영원히 사라진다)
 *
 * ⚠️ PAUSED 는 시간이 흐르지 않는다. 서버가 준 값이 그대로 답이다.
 *    여기서 흐르게 두면 화면의 집중 시간이 원장보다 커진다.
 */

interface BlockTimerInput {
    clock: ServerClock;
    /** 기준 시각(서버 로컬 문자열) 시점의 집중 초 */
    baseFocusSeconds: number;
    /** 기준 시각의 epoch millis */
    baseServerMillis: number;
    isRunning: boolean;
}

export function useBlockTimer({
    clock,
    baseFocusSeconds,
    baseServerMillis,
    isRunning,
}: BlockTimerInput): number {
    const [focusSeconds, setFocusSeconds] = useState(baseFocusSeconds);

    useEffect(
        function tick() {
            function recompute() {
                if (!isRunning) {
                    setFocusSeconds(baseFocusSeconds);
                    return;
                }
                const elapsedMillis = clock.currentServerMillis() - baseServerMillis;
                const elapsedSeconds = Math.floor(elapsedMillis / 1000);

                // 시계가 뒤로 갔거나(시각 보정) 기준이 미래면 음수가 나온다. 0 으로 막는다
                if (elapsedSeconds < 0) {
                    setFocusSeconds(baseFocusSeconds);
                    return;
                }
                setFocusSeconds(baseFocusSeconds + elapsedSeconds);
            }

            recompute();

            if (!isRunning) {
                return;
            }
            // 1초보다 촘촘히 돈다. 초가 바뀌는 순간과 틱이 어긋나면 숫자가 한 번씩 건너뛴다
            const timerId = window.setInterval(recompute, 250);

            return function cleanup() {
                window.clearInterval(timerId);
            };
        },
        [clock, baseFocusSeconds, baseServerMillis, isRunning],
    );

    return focusSeconds;
}
