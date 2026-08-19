import { formatHourMinute } from '@/lib/format';

/**
 * 월별 추이 — 12칸 막대.
 *
 * 축이 12칸으로 고정이라 데이터가 없는 달도 자리를 차지한다.
 * 있는 달만 그리면 막대 폭이 달마다 달라져 추이를 읽을 수 없다.
 */

export interface MonthlyPoint {
    /** 'yyyy-MM' */
    yearMonth: string;
    focusMinutes: number;
    calendarMinutes: number;
}

interface MonthlyStripProps {
    points: readonly MonthlyPoint[];
    /** 강조할 달 (보통 이번 달) */
    highlightYearMonth: string;
}

const MIN_BAR_HEIGHT_PERCENT = 6;

export function MonthlyStrip({ points, highlightYearMonth }: MonthlyStripProps) {
    let maxMinutes = 0;
    let yearTotalMinutes = 0;

    for (const point of points) {
        const combined = point.focusMinutes + point.calendarMinutes;
        yearTotalMinutes = yearTotalMinutes + combined;

        if (combined > maxMinutes) {
            maxMinutes = combined;
        }
    }

    return (
        <section className="strip" aria-label="월별 추이">
            <div className="strip-h">
                <span>월별 추이</span>
                <em className="num">올해 {formatHourMinute(yearTotalMinutes)}</em>
            </div>

            <div className="bars" aria-hidden="true">
                {points.map(function renderBar(point) {
                    const combined = point.focusMinutes + point.calendarMinutes;

                    // 0인 달도 흔적을 남긴다. 완전히 없애면 축이 비어 보인다
                    let heightPercent = MIN_BAR_HEIGHT_PERCENT;
                    if (maxMinutes > 0 && combined > 0) {
                        heightPercent = Math.max(
                            MIN_BAR_HEIGHT_PERCENT,
                            Math.round((combined / maxMinutes) * 100),
                        );
                    }

                    const isHighlighted = point.yearMonth === highlightYearMonth;

                    return (
                        <i
                            key={point.yearMonth}
                            className={isHighlighted ? 'on' : undefined}
                            style={{ height: `${heightPercent}%` }}
                        />
                    );
                })}
            </div>

            <div className="bars-x">
                {points.map(function renderLabel(point) {
                    const monthNumber = Number(point.yearMonth.slice(5, 7));
                    const isHighlighted = point.yearMonth === highlightYearMonth;

                    if (isHighlighted) {
                        return <b key={point.yearMonth}>{monthNumber}</b>;
                    }
                    return <span key={point.yearMonth}>{monthNumber}</span>;
                })}
            </div>
        </section>
    );
}
