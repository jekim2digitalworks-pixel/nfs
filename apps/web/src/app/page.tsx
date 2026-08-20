import Link from 'next/link';
import {
    CATEGORY_TAG_LABELS,
    STATISTICS_PERIODS,
    StatisticsPeriodSchema,
    type StatisticsPeriod,
} from '@nfs/domain';
import { nowInAppZone, workDateOf } from '@nfs/domain/time';
import { currentMemberId } from '@/server/auth/session';
import { findMemberSummary } from '@/server/services/member';
import {
    loadMonthlyTrend,
    loadStatisticsSummary,
    loadTagBreakdown,
    type MonthlyPoint,
    type TagBreakdown,
} from '@/server/services/statistics';
import { Ring } from '@/components/chart/Ring';
import { TagList } from '@/components/report/TagList';
import { MonthlyStrip } from '@/components/report/MonthlyStrip';
import { EmptyLedger } from '@/components/report/EmptyLedger';
import { CalendarOffer } from '@/components/state/CalendarOffer';
import { SectionError } from '@/components/state/SectionError';
import { formatDelta, formatHourMinute, splitHeroTime } from '@/lib/format';

/**
 * S-02 리포트 — 시간 가계부의 첫 화면.
 *
 * ⭐ **서버 컴포넌트가 서비스를 HTTP 없이 직접 호출한다** (아키텍처 §3).
 *    같은 프로세스인데 자기 API 를 fetch 하면 왕복이 순수한 낭비고,
 *    쿠키를 손으로 넘겨야 해서 코드도 지저분해진다.
 *
 * ⭐ **네 가지 상태를 모두 갖는다** (화면정의서 §0.4 · U-07):
 *    로딩은 `loading.tsx`, 비어 있음은 `EmptyLedger`, 부분 실패는 `SectionError`.
 */

const PERIOD_LABELS: Record<StatisticsPeriod, string> = {
    DAY: '일',
    WEEK: '주',
    MONTH: '월',
    YEAR: '년',
};

/** 기간 전환은 링크로 한다. 클라이언트 상태를 만들지 않으면 이 화면 전체가 서버에 남는다 */
function PeriodSegment({ current }: { current: StatisticsPeriod }) {
    return (
        <nav className="seg" aria-label="기간 선택">
            {STATISTICS_PERIODS.map(function renderPeriod(period) {
                return (
                    <Link
                        key={period}
                        href={period === 'MONTH' ? '/' : `/?period=${period}`}
                        aria-current={period === current ? 'page' : undefined}
                    >
                        {PERIOD_LABELS[period]}
                    </Link>
                );
            })}
        </nav>
    );
}

function SignedOut() {
    return (
        <>
            <div className="bloom" />
            <main className="screen screen-report">
                <section className="empty">
                    <h2>NFS — Not For Sale</h2>
                    <p>
                        당신에게 50년이 남았다면{' '}
                        <strong className="num">438,000</strong>시간입니다.
                    </p>
                    <p style={{ color: 'var(--tx3)' }}>이 시간은 어디서도 살 수 없습니다.</p>

                    {/* 구글 동의 화면으로 나가는 링크다. 브라우저 이동이므로 <a> 를 쓴다 */}
                    <a className="btn btn--primary" href="/api/auth/google/start" style={{ marginTop: 30 }}>
                        구글로 시작하기
                    </a>
                </section>
            </main>
        </>
    );
}

export default async function ReportPage(props: {
    // ⚠️ Next 16 에서 searchParams 는 Promise 다 (N-024)
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const memberId = await currentMemberId();

    if (memberId === null) {
        return <SignedOut />;
    }

    const searchParams = await props.searchParams;
    const rawPeriod = Array.isArray(searchParams['period'])
        ? searchParams['period'][0]
        : searchParams['period'];

    // 주소창을 손으로 고쳐 넣은 값이 화면을 깨뜨리지 않게 한다. 이상하면 기본값으로 돌린다
    const parsedPeriod = StatisticsPeriodSchema.safeParse(rawPeriod);
    const period: StatisticsPeriod = parsedPeriod.success ? parsedPeriod.data : 'MONTH';

    const now = nowInAppZone();
    const anchorDate = workDateOf(now);

    /**
     * ⭐ **총계와 분해를 따로 잡는다** (시안 G "조각 실패").
     *
     * 총계가 실패하면 이 화면은 할 말이 없으므로 그대로 던진다 — `error.tsx` 가 받는다.
     * 하지만 **분해나 추이가 실패했다고 총계까지 지우면 사실이 아닌 화면**이 된다.
     * 그래서 조각별로 감싸고, 실패한 자리에만 재시도 카드를 놓는다.
     */
    const [summary, member] = await Promise.all([
        loadStatisticsSummary(memberId, period, anchorDate),
        findMemberSummary(memberId),
    ]);

    let breakdown: TagBreakdown | null = null;
    try {
        breakdown = await loadTagBreakdown(memberId, period, anchorDate);
    } catch (caught) {
        console.error('[nfs] 태그별 분포 조회 실패', memberId.toString(), caught);
    }

    let monthlyPoints: MonthlyPoint[] | null = null;
    try {
        monthlyPoints = await loadMonthlyTrend(memberId, now.year);
    } catch (caught) {
        console.error('[nfs] 월별 추이 조회 실패', memberId.toString(), caught);
    }

    const calendarConnected = member !== null && member.googleScopeLevel !== 'NONE';
    const combinedMinutes = summary.totals.focusMinutes + summary.totals.calendarMinutes;
    const heroTime = splitHeroTime(combinedMinutes);
    const hasRecords = combinedMinutes > 0;

    return (
        <>
            <div className="bloom" />
            <div className="bloom-2" />

            <main className="screen screen-report">
                <header className="nav">
                    <span className="chip">{summary.range.label}</span>
                    <Link className="icon-btn" href="/settings" aria-label="설정">
                        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
                            <circle cx="8.5" cy="8.5" r="2.6" stroke="currentColor" strokeWidth="1.5" />
                            <path
                                d="M8.5 1v2M8.5 14v2M16 8.5h-2M3 8.5H1M13.8 3.2l-1.4 1.4M4.6 12.4l-1.4 1.4M13.8 13.8l-1.4-1.4M4.6 4.6 3.2 3.2"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                            />
                        </svg>
                    </Link>
                </header>

                {/* 기록이 없으면 히어로를 아예 그리지 않는다 (위 EmptyLedger 주석 참조) */}
                {hasRecords ? (
                    <section className="hero">
                        <p className="hero-cap">{summary.range.label}에 쓴 시간</p>
                        <h1 className="hero-num num">
                            {heroTime.hours}
                            <em>시간</em>
                            {heroTime.minutes}
                            <em>분</em>
                        </h1>

                        <span
                            className={`delta ${summary.focusDeltaMinutes >= 0 ? 'delta--up' : 'delta--down'} num`}
                        >
                            {summary.comparisonLabel} 집중 {formatDelta(summary.focusDeltaMinutes)}
                        </span>
                    </section>
                ) : null}

                <PeriodSegment current={period} />

                {/* ⭐ 미연동은 에러가 아니다. 질문(왜 일정 시간이 없지)이 생기는 자리 바로 아래에 답을 붙인다 */}
                {calendarConnected ? null : <CalendarOffer />}

                {!hasRecords ? (
                    <EmptyLedger periodLabel={summary.range.label} calendarConnected={calendarConnected} />
                ) : (
                    <ReportBody breakdown={breakdown} monthlyPoints={monthlyPoints} now={now} />
                )}
            </main>
        </>
    );
}

/**
 * 링 · 목록 · 추이. **조각마다 실패를 따로 표현한다.**
 *
 * 함수로 뺀 이유는 재사용이 아니라 **읽기 위해서**다 —
 * 페이지 본문에 두 겹의 조건이 더 들어가면 "언제 무엇이 보이는지"가 안 보인다.
 */
function ReportBody({
    breakdown,
    monthlyPoints,
    now,
}: {
    breakdown: TagBreakdown | null;
    monthlyPoints: MonthlyPoint[] | null;
    now: ReturnType<typeof nowInAppZone>;
}) {
    if (breakdown === null) {
        return (
            <>
                <SectionError
                    title="태그별 분포를 불러오지 못했어요"
                    detail="총 시간은 위에 그대로 있습니다. 분포만 다시 불러오면 됩니다."
                />
                {monthlyPoints === null ? null : (
                    <MonthlyStrip points={monthlyPoints} highlightYearMonth={now.toFormat('yyyy-MM')} />
                )}
            </>
        );
    }

    const topTag = breakdown.tags[0];

    // 링은 "무엇이 얼마나"만 알면 된다. 통계 DTO 를 그대로 넘기지 않고 필요한 두 값만 추린다 —
    // 차트 컴포넌트가 통계 스키마 변경에 끌려다니지 않게 하려는 것이다.
    const ringSegments = breakdown.tags.map(function toSegment(tag) {
        return { categoryTag: tag.categoryTag, minutes: tag.combinedMinutes };
    });

    return (
        <>
            <Ring
                segments={ringSegments}
                caption="가장 많이 쓴 곳"
                value={
                    topTag === undefined
                        ? '—'
                        : `${CATEGORY_TAG_LABELS[topTag.categoryTag]} ${formatHourMinute(topTag.combinedMinutes)}`
                }
                subValue={topTag === undefined ? '' : `전체의 ${topTag.sharePercent}%`}
            />

            <TagList tags={breakdown.tags} />

            {monthlyPoints === null ? (
                <SectionError
                    title="월별 추이를 불러오지 못했어요"
                    detail="이번 기간 숫자는 위에 그대로 있습니다."
                />
            ) : (
                <MonthlyStrip points={monthlyPoints} highlightYearMonth={now.toFormat('yyyy-MM')} />
            )}
        </>
    );
}
