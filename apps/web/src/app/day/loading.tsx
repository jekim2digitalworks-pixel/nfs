import { minutesFromStartOfDay, nowInAppZone } from '@nfs/domain/time';
import { Skeleton } from '@/components/state/Skeleton';

/**
 * S-03 하루 로딩 (U-07 · 시안 G)
 *
 * ⭐ **격자·시각 라벨·「지금 선」은 스켈레톤으로 덮지 않는다.**
 *    그건 서버가 주는 값이 아니라 **이미 아는 시간**이다. DB 를 기다릴 이유가 없고,
 *    덮으면 이미 아는 것을 일부러 늦게 보여주는 셈이 된다.
 *    스켈레톤이 서는 자리는 "블록과 일정이 올 곳" 뿐이다.
 *
 * ⚠️ 하루 화면과 **같은 구간 계산**을 쓴다. 다르면 데이터가 도착하는 순간
 *    격자가 통째로 스크롤되어, 안 튀게 하려던 스켈레톤이 오히려 튐을 만든다.
 */

/** ⚠️ `app/day/page.tsx` 와 같은 값이어야 한다 */
const HOURS_BEFORE_NOW = 1;
const VISIBLE_HOURS = 5;
const HOUR_HEIGHT_PX = 46;

function minutesToPixels(minutes: number): number {
    return minutes * (HOUR_HEIGHT_PX / 60);
}

export default function DayLoading() {
    // 서버 컴포넌트라 존을 아는 도메인 유틸을 그대로 쓴다.
    // 브라우저 시계를 쓰면 사용자 PC 가 틀어져 있을 때 지금 선이 엉뚱한 자리에 선다
    const now = nowInAppZone();
    const nowMinute = minutesFromStartOfDay(now);
    const fromHour = Math.max(
        0,
        Math.min(24 - VISIBLE_HOURS, Math.floor(nowMinute / 60) - HOURS_BEFORE_NOW),
    );
    const fromMinute = fromHour * 60;

    const hourLines: number[] = [];
    for (let index = 0; index <= VISIBLE_HOURS; index = index + 1) {
        hourLines.push(fromHour + index);
    }

    return (
        <>
            <div
                className="bloom bloom--dim"
                style={{
                    ['--bloom-color' as string]: 'rgba(255,176,32,.20)',
                    ['--bloom-y' as string]: '42%',
                }}
            />
            <div
                className="bloom-2 bloom--dim"
                style={{ ['--bloom2-color' as string]: 'rgba(124,140,255,.15)' }}
            />

            <main className="screen screen-day" aria-busy="true" aria-label="오늘을 불러오는 중">
                {/* 오늘이 며칠인지는 이미 안다. 여기에 스켈레톤을 깔 이유가 없다 */}
                <header className="nav">
                    <h1>
                        오늘
                        <span>{now.toFormat('M월 d일 cccc')}</span>
                    </h1>
                    <Skeleton width={36} height={36} />
                </header>

                <section className="budget">
                    <div className="budget-cap">
                        <span>오늘 남은 시간</span>
                    </div>
                    <Skeleton width={196} height={32} shape="block" marginTop={9} />
                    {/* ⚠️ 미터를 세 조각으로 미리 쪼개지 않는다. 몇 조각이 올지 모르는데
                        세 칸을 그려두면 도착하는 순간 갈라져 보인다 */}
                    <Skeleton width="100%" height={11} marginTop={15} />
                    <div className="keys">
                        <Skeleton width={88} height={11} />
                        <Skeleton width={78} height={11} />
                        <Skeleton width={64} height={11} />
                    </div>
                </section>

                <div className="tl-h">
                    <span>지금부터</span>
                    <em className="num">
                        {String(fromHour).padStart(2, '0')}:00 –{' '}
                        {String(fromHour + VISIBLE_HOURS).padStart(2, '0')}:00
                    </em>
                </div>

                <div className="tl" style={{ height: minutesToPixels(VISIBLE_HOURS * 60) }}>
                    {hourLines.map(function renderHourLine(hour) {
                        return (
                            <div
                                key={hour}
                                className="gl"
                                style={{ top: minutesToPixels((hour - fromHour) * 60) }}
                            >
                                <b className="num">{String(hour).padStart(2, '0')}:00</b>
                            </div>
                        );
                    })}

                    <div className="lane">
                        {/* 블록이 몇 개 올지는 모른다. 이건 값이 아니라 "여기에 온다"는 자리 표시다 —
                            폭·높이는 실제 블록 규격(왼쪽 69% · 전체 폭)을 따른다 */}
                        <span
                            className="sk sk--block"
                            style={{ position: 'absolute', top: 98, left: 0, width: '69%', height: 63 }}
                            aria-hidden="true"
                        />
                        <span
                            className="sk sk--block"
                            style={{ position: 'absolute', top: 190, left: 0, width: '100%', height: 34 }}
                            aria-hidden="true"
                        />
                        <span
                            className="sk sk--block"
                            style={{ position: 'absolute', top: 250, left: 0, width: '69%', height: 40 }}
                            aria-hidden="true"
                        />

                        <div
                            className="nowline"
                            style={{ top: minutesToPixels(nowMinute - fromMinute) }}
                            aria-hidden="true"
                        >
                            <b className="num">{now.toFormat('HH:mm')}</b>
                        </div>
                    </div>
                </div>
            </main>
        </>
    );
}
