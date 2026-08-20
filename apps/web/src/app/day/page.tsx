import {
    minutesFromStartOfDay,
    minutesUntilMidnight,
    nowInAppZone,
    toAppLocalString,
    workDateOf,
} from '@nfs/domain/time';
import { currentMemberId } from '@/server/auth/session';
import { listBlocksOfDate, loadDayBudget } from '@/server/services/block';
import { loadDayOccupants } from '@/server/services/day-occupants';
import { loadCalendarConnection } from '@/server/services/calendar-sync';
import { BudgetMeter } from '@/components/day/BudgetMeter';
import { BlockSheet, type SerializedOccupant } from '@/components/day/BlockSheet';
import {
    CalendarSyncBanner,
    CalendarSyncButton,
    CalendarSyncProvider,
} from '@/components/day/CalendarSync';
import {
    Timeline,
    type TimelineBlock,
    type TimelineEvent,
    type TimelineProposal,
} from '@/components/day/Timeline';

/**
 * S-03 하루 — "지금부터 3시간"에 집중하게 만드는 화면.
 *
 * 하루 전체를 보여주지 않는다. 그게 이 제품이 없애려는 피로다 (기획 §1.4).
 * 지금 시각을 중심으로 앞뒤 몇 시간만 연다.
 */

/** 타임라인이 여는 구간. 지금 한 시간 전부터 3시간 뷰 + 여유 */
const HOURS_BEFORE_NOW = 1;
const VISIBLE_HOURS = 5;

/** 오늘이 통째로 비었을 때 제안하는 길이 (화면정의서 S-03 "지금부터 3시간") */
const PROPOSAL_MINUTES = 180;

function SignedOut() {
    return (
        <>
            <div className="bloom" />
            <main className="screen screen-day">
                <section className="empty">
                    <h2>하루</h2>
                    <p>로그인하면 오늘의 예산과 블록이 보입니다.</p>
                    <a className="btn btn--primary" href="/api/auth/google/start" style={{ marginTop: 30 }}>
                        구글로 시작하기
                    </a>
                </section>
            </main>
        </>
    );
}

export default async function DayPage({
    // ⚠️ Next 16 에서 searchParams 는 Promise 다 (N-024)
    searchParams,
}: {
    searchParams: Promise<{ new?: string }>;
}) {
    const memberId = await currentMemberId();

    if (memberId === null) {
        return <SignedOut />;
    }

    // 집중 화면의 "계속 이어서"와 집중 탭(진행 중 블록 없음)이 여기로 보낸다.
    // 시트를 별도 라우트로 만들지 않는 이유: 뒤의 하루 화면이 맥락이기 때문이다
    const query = await searchParams;
    const shouldOpenSheet = query.new === '1';

    const now = nowInAppZone();
    const workDate = workDateOf(now);

    const [budget, blocks, occupants, calendar] = await Promise.all([
        loadDayBudget(memberId, workDate),
        listBlocksOfDate(memberId, workDate, now),
        loadDayOccupants(memberId, workDate),
        loadCalendarConnection(memberId, now),
    ]);

    const nowMinute = minutesFromStartOfDay(now);

    // 표시 구간. 자정 근처에서 음수가 되지 않게 0으로 접는다
    const fromHour = Math.max(0, Math.min(24 - VISIBLE_HOURS, Math.floor(nowMinute / 60) - HOURS_BEFORE_NOW));

    const timelineBlocks: TimelineBlock[] = [];
    for (const block of blocks) {
        const startMinute = minutesFromStartOfDay(
            // plannedStartTime 은 'yyyy-MM-ddTHH:mm:ss' 문자열이다. 시:분만 쓰면 충분하다
            now.set({
                hour: Number(block.plannedStartTime.slice(11, 13)),
                minute: Number(block.plannedStartTime.slice(14, 16)),
                second: 0,
                millisecond: 0,
            }),
        );

        const isLive = block.blockStatus === 'RUNNING';
        const progressPercent =
            block.plannedMinutes > 0
                ? Math.min(100, Math.round((block.focusSeconds / 60 / block.plannedMinutes) * 100))
                : 0;

        timelineBlocks.push({
            activeBlockId: block.activeBlockId,
            title: block.title,
            categoryTag: block.categoryTag,
            startMinute: startMinute,
            lengthMinutes: block.plannedMinutes,
            isLive: isLive,
            progressPercent: progressPercent,
        });
    }

    // 캘린더 일정만 타임라인 오른쪽에 그린다. 원장·블록은 이미 왼쪽에 있다
    const timelineEvents: TimelineEvent[] = [];
    for (const occupant of occupants) {
        if (occupant.sourceType !== 'GOOGLE_CALENDAR') {
            continue;
        }
        const startMinute = minutesFromStartOfDay(occupant.startTime);
        const lengthMinutes = Math.round(occupant.endTime.diff(occupant.startTime, 'minutes').minutes);

        timelineEvents.push({
            key: occupant.referenceKey,
            title: occupant.title,
            startMinute: startMinute,
            lengthMinutes: lengthMinutes,
        });
    }

    /**
     * 시트가 미리보기를 **서버와 같은 계산기**로 계산하려면 점유자가 필요하다.
     * Luxon DateTime 은 서버→클라 경계를 넘지 못하므로 로컬 시각 문자열로 바꿔 넘긴다.
     */
    const serializedOccupants: SerializedOccupant[] = [];
    for (const occupant of occupants) {
        serializedOccupants.push({
            referenceKey: occupant.referenceKey,
            sourceType: occupant.sourceType,
            categoryTag: occupant.categoryTag,
            title: occupant.title,
            startTime: toAppLocalString(occupant.startTime),
            endTime: toAppLocalString(occupant.endTime),
        });
    }

    /**
     * ⭐ **오늘이 통째로 빈 상태는 "없음"이 아니다.**
     *    남은 시간이 최대인 상태 — 이 앱에서 가장 좋은 상태다 (시안 G · N-037).
     *    그래서 화면을 회색으로 죽이지 않고, 격자 위에 "지금부터 3시간" 구간만 얹는다.
     */
    const isDayEmpty = timelineBlocks.length === 0 && timelineEvents.length === 0;

    let proposal: TimelineProposal | undefined = undefined;
    if (isDayEmpty) {
        proposal = {
            startMinute: nowMinute,
            lengthMinutes: PROPOSAL_MINUTES,
            labelLines: ['지금부터 3시간,', '무엇에 쓸까요?'],
            actionLabel: '블록 만들기',
            href: '/day?new=1',
        };
    }

    return (
        <>
            {/* 하루 화면의 광원은 중앙의 따뜻한 앰버다 (디자인 §2.4) */}
            <div
                className="bloom"
                style={{
                    ['--bloom-color' as string]: 'rgba(255,176,32,.20)',
                    ['--bloom-y' as string]: '42%',
                }}
            />
            <div className="bloom-2" style={{ ['--bloom2-color' as string]: 'rgba(124,140,255,.15)' }} />

            <main className="screen screen-day">
                {/* ⭐ 헤더의 실패 점과 미터 아래 배너가 **같은 사실**을 본다.
                    상태를 두 벌 두면 반드시 어긋나므로 컨텍스트로 묶는다 (U-07) */}
                <CalendarSyncProvider lastSyncedLabel={calendar.lastSyncedLabel}>
                    <header className="nav">
                        <h1>
                            오늘
                            <span>{now.toFormat('M월 d일 cccc')}</span>
                        </h1>
                        {/* 캘린더 다시 불러오기 (B-11 · 화면정의서 S-03 헤더) */}
                        <CalendarSyncButton />
                    </header>

                    <BudgetMeter
                        totalMinutes={budget.totalMinutes}
                        occupiedMinutes={budget.occupiedMinutes}
                        remainingMinutes={budget.remainingMinutes}
                        blockMinutes={budget.blockMinutes}
                        calendarMinutes={budget.calendarMinutes}
                        overlapMinutes={budget.overlapMinutes}
                        minutesUntilMidnight={minutesUntilMidnight(now)}
                        calendarConnected={calendar.connected}
                    />

                    {/* 실패했을 때만 나온다. 화면을 덮지 않고 미터 바로 아래에서 말한다 */}
                    <CalendarSyncBanner />
                </CalendarSyncProvider>

                <div className="tl-h">
                    <span>지금부터</span>
                    <em className="num">
                        {String(fromHour).padStart(2, '0')}:00 – {String(fromHour + VISIBLE_HOURS).padStart(2, '0')}
                        :00
                    </em>
                </div>

                <Timeline
                    fromHour={fromHour}
                    hourCount={VISIBLE_HOURS}
                    blocks={timelineBlocks}
                    events={timelineEvents}
                    nowMinute={nowMinute}
                    nowLabel={now.toFormat('HH:mm')}
                    proposal={proposal}
                />

                {/* S-05 블록 생성 시트 (U-06). FAB 은 시트가 자기 트리거로 갖고 있다 */}
                <BlockSheet
                    workDate={workDate}
                    nowLocal={toAppLocalString(now)}
                    occupants={serializedOccupants}
                    defaultOpen={shouldOpenSheet}
                />
            </main>
        </>
    );
}
