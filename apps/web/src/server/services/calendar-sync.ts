import 'server-only';
import type { DateTime } from 'luxon';
import {
    classifyEvent,
    mapCategoryTag,
    weekRangeOf,
    type CalendarEventCandidate,
    type CategoryTag,
    type ExclusionReason,
} from '@nfs/domain';
import {
    dateStringToDateColumn,
    instantFromColumn,
    instantFromIsoString,
    instantToColumn,
    parseAppDate,
    weekStartDateOf,
} from '@nfs/domain/time';
import { prisma } from '../prisma';
import { decryptRefreshToken } from '../auth/token-cipher';
import { refreshAccessToken } from '../auth/google-oauth';

/**
 * 구글 캘린더 읽기 동기화 (B-11 · 정책 §4)
 *
 * 파이프는 한 방향이다: **구글 → NFS**. 그것도 **열린 주만** 읽는다 (정책 §3.2).
 * 마감된 주를 다시 읽는 코드 경로는 존재하지 않는다 — 여기가 그 유일한 입구이고,
 * 이 함수는 `weekly_closing` 이 `CLOSED` 면 그대로 돌아선다.
 *
 * ⭐ 읽어온 일정은 `imported_calendar_event` 에 **쌓아둔다.** 원장이 아니다.
 *   주간 마감(B-09)이 그걸 `TimeLog` 로 옮기고 지운다.
 *   주중 내내 쌓아두는 이유: 마감 시점에만 호출하는 설계라면 하필 그때 토큰이 만료돼 있을 때
 *   **그 주 데이터를 영구히 잃는다** (정책 §3.4).
 *
 * ⚠️ 라이브러리(googleapis)를 쓰지 않는다. 필요한 건 엔드포인트 하나(events.list)뿐이고,
 *    구글 SDK 는 수십 MB 에 콜드스타트를 늘린다 — 로그인 쪽과 같은 판단이다.
 */

const CALENDAR_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/**
 * 한 번에 가져올 최대 개수. 한 주에 250개를 넘는 일정은 캘린더가 아니라 로그다.
 * 넘치면 다음 페이지를 따라가지 않고 자른다 — 예산 계산이 250개에서 흔들리지 않는다
 */
const MAX_EVENTS = 250;

export type CalendarSyncStatus =
    /** 정상 동기화 */
    | 'SYNCED'
    /** 구글 연동이 없다 */
    | 'NOT_CONNECTED'
    /** 토큰 만료·구글 장애. 조용히 0시간으로 처리하지 않는다 (정책 §3.4) */
    | 'FAILED';

export interface CalendarSyncResultView {
    status: CalendarSyncStatus;
    weekStartDate: string;
    /** 저장된(제외분 포함) 일정 수 */
    importedCount: number;
    /** 필터에 걸려 통계에서 빠진 수 */
    excludedCount: number;
    syncedTime: DateTime | null;
}

/** 구글 events.list 응답 중 우리가 쓰는 부분 */
interface GoogleEventTime {
    dateTime?: string;
    date?: string;
}

interface GoogleEvent {
    id: string;
    status?: string;
    summary?: string;
    colorId?: string;
    etag?: string;
    start?: GoogleEventTime;
    end?: GoogleEventTime;
    attendees?: Array<{ self?: boolean; responseStatus?: string }>;
    extendedProperties?: { private?: Record<string, string> };
}

/**
 * ⭐ 우리가 쓴 일정에 심는 표식 (에코 루프 차단 · 정책 §4.1)
 *
 * 쓰기 파이프(B-15)는 Phase 2 지만 **키 이름을 지금 고정한다.**
 * 나중에 정하면 그 사이에 쓴 일정들이 표식 없이 남아 영원히 이중 집계된다.
 */
export const NFS_BLOCK_MARKER_KEY = 'nfsBlockId';

function toCandidate(event: GoogleEvent): CalendarEventCandidate | null {
    const startRaw = event.start;
    const endRaw = event.end;

    if (startRaw === undefined || endRaw === undefined) {
        return null;
    }

    // 종일 일정은 dateTime 없이 date 만 온다. 그 사실 자체가 판정 근거다
    const isAllDay = startRaw.dateTime === undefined;

    let startTime: DateTime;
    let endTime: DateTime;

    try {
        if (isAllDay) {
            if (startRaw.date === undefined || endRaw.date === undefined) {
                return null;
            }
            // ⚠️ 'yyyy-MM-dd' 를 raw Date 로 파싱하면 UTC 자정 → 한국 09:00 이 된다.
            //    존을 아는 도메인 파서만 쓴다 (ESLint 가 강제한다)
            startTime = parseAppDate(startRaw.date);
            endTime = parseAppDate(endRaw.date);
        } else {
            const startIso = startRaw.dateTime;
            const endIso = endRaw.dateTime;

            if (startIso === undefined || endIso === undefined) {
                return null;
            }
            // 구글은 오프셋이 붙은 ISO 를 준다. 그들의 존에서 우리 존으로 옮겨 담는다
            startTime = instantFromIsoString(startIso);
            endTime = instantFromIsoString(endIso);
        }
    } catch {
        // 파싱 실패한 일정 하나가 동기화 전체를 막지 않는다
        return null;
    }

    let isDeclinedByMe = false;
    if (event.attendees !== undefined) {
        for (const attendee of event.attendees) {
            if (attendee.self === true && attendee.responseStatus === 'declined') {
                isDeclinedByMe = true;
            }
        }
    }

    let isWrittenByNfs = false;
    if (event.extendedProperties !== undefined && event.extendedProperties.private !== undefined) {
        if (event.extendedProperties.private[NFS_BLOCK_MARKER_KEY] !== undefined) {
            isWrittenByNfs = true;
        }
    }

    let title = '(제목 없음)';
    if (event.summary !== undefined && event.summary.length > 0) {
        title = event.summary;
    }

    let colorId: string | null = null;
    if (event.colorId !== undefined) {
        colorId = event.colorId;
    }

    return {
        googleEventId: event.id,
        title: title.slice(0, 200),
        startTime: startTime,
        endTime: endTime,
        isAllDay: isAllDay,
        isDeclinedByMe: isDeclinedByMe,
        isWrittenByNfs: isWrittenByNfs,
        colorId: colorId,
    };
}

async function fetchWeekEvents(
    accessToken: string,
    weekStartDate: string,
): Promise<GoogleEvent[] | null> {
    const range = weekRangeOf(weekStartDate);

    // Luxon 의 toISO 는 무효 시각에 null 을 준다. 여기서는 주 구간이라 항상 유효하지만,
    // 빈 문자열로 요청이 나가면 구글이 "그 주 전체"가 아니라 엉뚱한 범위를 준다
    const timeMin = range.startInstant.toISO();
    const timeMax = range.endInstant.toISO();

    if (timeMin === null || timeMax === null) {
        return null;
    }

    const params = new URLSearchParams({
        timeMin: timeMin,
        timeMax: timeMax,
        // ⭐ 반복 일정을 개별 인스턴스로 펴서 받는다. 안 하면 규칙(RRULE)을 우리가 해석해야 한다
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(MAX_EVENTS),
    });

    const response = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        const detail = await response.text();
        console.error('[nfs] calendar events fetch failed', response.status, detail.slice(0, 300));
        return null;
    }

    const body = (await response.json()) as { items?: GoogleEvent[] };

    if (body.items === undefined) {
        return [];
    }
    return body.items;
}

/**
 * 열린 주 하나를 동기화한다.
 *
 * 처리 순서
 *   1. 마감 여부 확인 — CLOSED 면 아무것도 하지 않는다 (동결된 주는 다시 읽지 않는다)
 *   2. 리프레시 토큰 복호화 → 액세스 토큰 발급
 *   3. events.list 로 그 주 구간을 읽는다
 *   4. 필터 7종 적용 → 태그 매핑
 *   5. upsert (⭐ **사용자 토글은 덮어쓰지 않는다**)
 *   6. 사라진 일정 정리 + `weekly_closing` 을 OPEN 으로 갱신
 */
export async function syncCalendarWeek(
    memberId: bigint,
    weekStartDate: string,
    now: DateTime,
): Promise<CalendarSyncResultView> {
    const weekColumn = dateStringToDateColumn(weekStartDate);

    const emptyResult: CalendarSyncResultView = {
        status: 'NOT_CONNECTED',
        weekStartDate: weekStartDate,
        importedCount: 0,
        excludedCount: 0,
        syncedTime: null,
    };

    const closing = await prisma.weeklyClosing.findUnique({
        where: { memberId_weekStartDate: { memberId: memberId, weekStartDate: weekColumn } },
    });

    if (closing !== null && closing.closingStatus === 'CLOSED') {
        // 마감된 주는 영구히 동결이다 (정책 §3.2). 여기서 돌아서는 게 그 규칙의 구현이다
        return { ...emptyResult, status: closing.calendarSyncResult as CalendarSyncStatus };
    }

    const member = await prisma.member.findUnique({
        where: { memberId: memberId },
        select: { googleScopeLevel: true, googleRefreshToken: true },
    });

    if (member === null || member.googleScopeLevel === 'NONE' || member.googleRefreshToken === null) {
        return emptyResult;
    }

    const refreshToken = decryptRefreshToken(member.googleRefreshToken);

    if (refreshToken === null) {
        // 복호화 실패 = 키가 바뀌었거나 저장값이 깨졌다. 재로그인이 필요한 상태다
        console.error('[nfs] refresh token 복호화 실패', memberId.toString());
        return { ...emptyResult, status: 'FAILED' };
    }

    const accessToken = await refreshAccessToken(refreshToken);

    if (accessToken === null) {
        // 테스트 모드 7일 만료(N-028)가 여기로 온다. 조용히 0시간으로 처리하지 않는다
        return { ...emptyResult, status: 'FAILED' };
    }

    const events = await fetchWeekEvents(accessToken, weekStartDate);

    if (events === null) {
        return { ...emptyResult, status: 'FAILED' };
    }

    const seenEventIds: string[] = [];
    let importedCount = 0;
    let excludedCount = 0;

    const colorToTag = await loadColorMapping(memberId);

    for (const event of events) {
        // 취소된 일정은 저장하지 않는다. 아래 정리 단계가 기존 행을 지운다
        if (event.status === 'cancelled') {
            continue;
        }

        const candidate = toCandidate(event);
        if (candidate === null) {
            continue;
        }

        const decision = classifyEvent(candidate);
        const categoryTag: CategoryTag = mapCategoryTag(candidate.colorId, colorToTag);

        let etag: string | null = null;
        if (event.etag !== undefined) {
            etag = event.etag;
        }

        let exclusionReason: ExclusionReason | null = decision.reason;

        // ⭐ **사용자가 직접 끈 일정은 필터 결과가 덮어쓰지 않는다** (정책 §4.2 #6).
        //    동기화가 사용자의 결정을 되돌리면, 끈 일정이 다음 동기화마다 되살아난다
        const existing = await prisma.importedCalendarEvent.findUnique({
            where: {
                memberId_googleEventId: {
                    memberId: memberId,
                    googleEventId: candidate.googleEventId,
                },
            },
            select: { excludedFromStatistics: true, exclusionReason: true },
        });

        let excluded = decision.excluded;

        if (existing !== null && existing.exclusionReason === 'USER') {
            excluded = true;
            exclusionReason = 'USER';
        }

        await prisma.importedCalendarEvent.upsert({
            where: {
                memberId_googleEventId: {
                    memberId: memberId,
                    googleEventId: candidate.googleEventId,
                },
            },
            create: {
                memberId: memberId,
                googleCalendarId: 'primary',
                googleEventId: candidate.googleEventId,
                googleEtag: etag,
                title: candidate.title,
                googleColorId: candidate.colorId,
                mappedCategoryTag: categoryTag,
                startTime: instantToColumn(candidate.startTime),
                endTime: instantToColumn(candidate.endTime),
                weekStartDate: weekColumn,
                excludedFromStatistics: excluded,
                exclusionReason: exclusionReason,
                lastSyncedTime: instantToColumn(now),
            },
            update: {
                googleEtag: etag,
                title: candidate.title,
                googleColorId: candidate.colorId,
                mappedCategoryTag: categoryTag,
                startTime: instantToColumn(candidate.startTime),
                endTime: instantToColumn(candidate.endTime),
                weekStartDate: weekColumn,
                excludedFromStatistics: excluded,
                exclusionReason: exclusionReason,
                lastSyncedTime: instantToColumn(now),
            },
        });

        seenEventIds.push(candidate.googleEventId);
        importedCount = importedCount + 1;

        if (excluded) {
            excludedCount = excludedCount + 1;
        }
    }

    // 구글에서 지워지거나 다른 주로 옮겨간 일정을 정리한다.
    // 안 지우면 사용자가 지운 회의가 예산을 계속 갉아먹는다
    await prisma.importedCalendarEvent.deleteMany({
        where: {
            memberId: memberId,
            weekStartDate: weekColumn,
            googleEventId: { notIn: seenEventIds },
        },
    });

    // 주간 마감 배치가 이 행을 보고 대상을 고른다 (N-032 의 수집 경로 ①)
    await prisma.weeklyClosing.upsert({
        where: { memberId_weekStartDate: { memberId: memberId, weekStartDate: weekColumn } },
        create: {
            memberId: memberId,
            weekStartDate: weekColumn,
            closingStatus: 'OPEN',
            calendarSyncResult: 'SYNCED',
            lastSyncedTime: instantToColumn(now),
            importedEventCount: importedCount,
        },
        update: {
            calendarSyncResult: 'SYNCED',
            lastSyncedTime: instantToColumn(now),
            importedEventCount: importedCount,
        },
    });

    return {
        status: 'SYNCED',
        weekStartDate: weekStartDate,
        importedCount: importedCount,
        excludedCount: excludedCount,
        syncedTime: now,
    };
}

/** 색상 → 태그 매핑 (B-12). 없으면 전부 미분류가 된다 */
async function loadColorMapping(memberId: bigint): Promise<Map<string, CategoryTag>> {
    const rows = await prisma.categoryColorMapping.findMany({
        where: { memberId: memberId },
        select: { googleColorId: true, categoryTag: true },
    });

    const mapping = new Map<string, CategoryTag>();
    for (const row of rows) {
        mapping.set(row.googleColorId, row.categoryTag);
    }
    return mapping;
}

/** 이번 주를 동기화한다. 하루 화면의 "캘린더 다시 불러오기"가 부른다 */
export async function syncCurrentWeek(
    memberId: bigint,
    now: DateTime,
): Promise<CalendarSyncResultView> {
    return await syncCalendarWeek(memberId, weekStartDateOf(now), now);
}

/**
 * 화면이 캘린더 상태를 물어보는 창구 (U-07)
 *
 * ⭐ **연결 여부는 클릭이 아니라 서버가 안다.** 버튼을 눌러봐야 아는 구조면
 *    처음 들어온 사용자는 "일정 시간이 왜 없지"를 스스로 알아내야 한다.
 *
 * `lastSyncedTime` 은 마지막으로 **실제로 읽어온** 시각이다.
 * 실패한 시도는 여기 남지 않는다 — 그래서 "지난번에 읽은 일정으로 보여주고 있습니다"의
 * '지난번'이 정직한 값이 된다.
 */
export interface CalendarConnectionView {
    connected: boolean;
    /** 'HH:mm'. 이번 주를 한 번도 못 읽었으면 null */
    lastSyncedLabel: string | null;
}

export async function loadCalendarConnection(
    memberId: bigint,
    now: DateTime,
): Promise<CalendarConnectionView> {
    const weekColumn = dateStringToDateColumn(weekStartDateOf(now));

    const [member, closing] = await Promise.all([
        prisma.member.findUnique({
            where: { memberId: memberId },
            select: { googleScopeLevel: true },
        }),
        prisma.weeklyClosing.findUnique({
            where: { memberId_weekStartDate: { memberId: memberId, weekStartDate: weekColumn } },
            select: { lastSyncedTime: true },
        }),
    ]);

    let connected = false;
    if (member !== null && member.googleScopeLevel !== 'NONE') {
        connected = true;
    }

    let lastSyncedLabel: string | null = null;
    if (closing !== null && closing.lastSyncedTime !== null) {
        lastSyncedLabel = instantFromColumn(closing.lastSyncedTime).toFormat('HH:mm');
    }

    return { connected: connected, lastSyncedLabel: lastSyncedLabel };
}
