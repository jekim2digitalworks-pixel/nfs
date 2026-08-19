import { formatHourMinute, splitHeroTime } from '@/lib/format';

/**
 * 24시간 예산 미터 (정책 §2.5)
 *
 * **상시 노출되는 건 「남은 시간」과 미터뿐이다.**
 * 초과 경고는 실제로 막힐 때만 나온다 — 걸리지 않는 제약을 상시 설명하지 않는다 (N-010).
 *
 * 캘린더는 빗금, 내 블록만 발광한다.
 * 소재로 구분하는 이유는 하나가 '주장된 시간'이고 하나가 '증명된 시간'이기 때문이다.
 */

interface BudgetMeterProps {
    totalMinutes: number;
    occupiedMinutes: number;
    remainingMinutes: number;
    blockMinutes: number;
    calendarMinutes: number;
    overlapMinutes: number;
    minutesUntilMidnight: number;
}

export function BudgetMeter({
    totalMinutes,
    occupiedMinutes,
    remainingMinutes,
    blockMinutes,
    calendarMinutes,
    overlapMinutes,
    minutesUntilMidnight,
}: BudgetMeterProps) {
    const remaining = splitHeroTime(remainingMinutes);

    // 미터는 세 조각의 비율로만 그린다. 합이 100%가 되도록 flex-grow 를 쓴다
    const freeMinutes = Math.max(0, totalMinutes - occupiedMinutes);

    return (
        <section className="budget" aria-label="오늘 남은 시간">
            <div className="budget-cap">
                <span>오늘 남은 시간</span>
                <em className="num">자정까지 {formatHourMinute(minutesUntilMidnight)}</em>
            </div>

            <p className="budget-num num">
                {remaining.hours}
                <i>시간</i>
                {remaining.minutes}
                <i>분</i>
            </p>

            <div
                className="meter"
                role="img"
                aria-label={`24시간 중 ${formatHourMinute(occupiedMinutes)} 사용, ${formatHourMinute(remainingMinutes)} 남음`}
            >
                {calendarMinutes > 0 ? (
                    <i className="m-cal" style={{ flexGrow: calendarMinutes }} />
                ) : null}
                {blockMinutes > 0 ? <i className="m-nfs" style={{ flexGrow: blockMinutes }} /> : null}
                {freeMinutes > 0 ? <i className="m-free" style={{ flexGrow: freeMinutes }} /> : null}
            </div>

            <div className="keys">
                <span>
                    <b className="m-nfs" style={{ background: 'var(--dev)' }} />내 블록{' '}
                    <span className="num">{formatHourMinute(blockMinutes)}</span>
                </span>
                <span>
                    <b style={{ background: 'rgba(255,255,255,.32)' }} />
                    캘린더 <span className="num">{formatHourMinute(calendarMinutes)}</span>
                </span>
                <span>
                    <b style={{ background: 'rgba(255,255,255,.12)' }} />
                    빈 시간 <span className="num">{formatHourMinute(freeMinutes)}</span>
                </span>
            </div>

            {/* 겹친 시간을 굳이 말해주는 이유: 말하지 않으면 사용자가 숫자를 직접 더해보고
                "합이 안 맞는다"고 느낀다. 계산은 서버가 한 번만 한다 */}
            {overlapMinutes > 0 ? (
                <p className="overlap-note num">
                    겹친 {formatHourMinute(overlapMinutes)}은 한 번만 셌습니다.
                </p>
            ) : null}
        </section>
    );
}
