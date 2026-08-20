import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instantFromColumn, parseAppDate, parseAppDateTime } from '@nfs/domain/time';

/**
 * 캘린더 동기화 통합 테스트 (T-03 · 테스트계획 §4.2 · §5 · §6)
 *
 * 도메인 필터(`event-filter.test.ts`)는 "무엇을 뺄지"를 이미 지킨다.
 * **여기서 지키는 것은 그 판단이 DB 행까지 그대로 도달하는가**다.
 * 둘 사이에서 깨질 수 있는 것들:
 *
 *   - 마감된 주인데 구글을 부른다 (동결이 뚫린다)
 *   - 필터는 맞게 판단했는데 `exclusion_reason` 이 엉뚱하게 저장된다
 *   - 사용자가 끈 일정을 동기화가 되살린다
 *   - 토큰이 만료됐는데 조용히 "0건 동기화 성공"으로 넘어간다
 *   - 구글이 준 오프셋 ISO 를 프로세스 존(UTC)으로 읽어 9시간 어긋난다
 *
 * ⭐ **이 스위트는 `TZ=UTC` 로 돈다** (vitest.config.ts). 그게 Vercel 과 Actions 의 실제 환경이다.
 *    존을 아는 곳이 도메인 하나뿐임을 증명하는 게 §6 의 핵심이다.
 */

// vi.mock 은 import 보다 먼저 끌어올려진다. 모듈 팩토리가 볼 수 있게 hoisted 로 만든다
const mocks = vi.hoisted(function createMocks() {
    return {
        decryptRefreshToken: vi.fn(),
        refreshAccessToken: vi.fn(),
    };
});

vi.mock('../auth/token-cipher', function stubTokenCipher() {
    return { decryptRefreshToken: mocks.decryptRefreshToken };
});

vi.mock('../auth/google-oauth', function stubGoogleOAuth() {
    return { refreshAccessToken: mocks.refreshAccessToken };
});

/** upsert 로 저장된 행을 그대로 붙잡아 둔다. 테스트가 보고 싶은 건 이 값들이다 */
interface RecordedEvent {
    googleEventId: string;
    title: string;
    mappedCategoryTag: string;
    excludedFromStatistics: boolean;
    exclusionReason: string | null;
    startTime: Date;
    endTime: Date;
    weekStartDate: Date;
}

interface ExistingEventRow {
    excludedFromStatistics: boolean;
    exclusionReason: string | null;
}

interface FakeState {
    closingRow: { closingStatus: string; calendarSyncResult: string } | null;
    memberRow: { googleScopeLevel: string; googleRefreshToken: string | null } | null;
    colorMappingRows: Array<{ googleColorId: string; categoryTag: string }>;
    /** 이미 DB 에 있는 행 — 사용자 토글 보존을 재현하기 위한 것 */
    existingEvents: Map<string, ExistingEventRow>;
    upsertedEvents: RecordedEvent[];
    deletedEventFilters: unknown[];
    upsertedClosings: unknown[];
}

const state = vi.hoisted(function createState(): FakeState {
    return {
        closingRow: null,
        memberRow: null,
        colorMappingRows: [],
        existingEvents: new Map(),
        upsertedEvents: [],
        deletedEventFilters: [],
        upsertedClosings: [],
    };
});

vi.mock('../prisma', function stubPrisma() {
    return {
        prisma: {
            weeklyClosing: {
                findUnique: async function findClosing() {
                    return state.closingRow;
                },
                upsert: async function upsertClosing(args: unknown) {
                    state.upsertedClosings.push(args);
                    return {};
                },
            },
            member: {
                findUnique: async function findMember() {
                    return state.memberRow;
                },
            },
            categoryColorMapping: {
                findMany: async function findColorMappings() {
                    return state.colorMappingRows;
                },
            },
            importedCalendarEvent: {
                findUnique: async function findEvent(args: {
                    where: { memberId_googleEventId: { googleEventId: string } };
                }) {
                    const key = args.where.memberId_googleEventId.googleEventId;
                    const found = state.existingEvents.get(key);

                    if (found === undefined) {
                        return null;
                    }
                    return found;
                },
                upsert: async function upsertEvent(args: { create: RecordedEvent }) {
                    state.upsertedEvents.push(args.create);
                    return {};
                },
                deleteMany: async function deleteEvents(args: unknown) {
                    state.deletedEventFilters.push(args);
                    return { count: 0 };
                },
            },
        },
    };
});

const { syncCalendarWeek } = await import('./calendar-sync');

const MEMBER_ID = BigInt(1);
/** 2026-08-17 은 월요일이다 */
const WEEK_START = '2026-08-17';
const NOW = parseAppDateTime('2026-08-19T14:00');

/** 구글 events.list 응답을 흉내 낸다. 진짜 fetch 는 절대 나가지 않는다 */
function stubGoogleEvents(items: unknown[]): void {
    const fetchStub = vi.fn(async function fakeFetch() {
        return {
            ok: true,
            status: 200,
            json: async function readBody() {
                return { items: items };
            },
            text: async function readText() {
                return '';
            },
        };
    });
    vi.stubGlobal('fetch', fetchStub);
}

function stubGoogleFailure(status: number): void {
    const fetchStub = vi.fn(async function fakeFetch() {
        return {
            ok: false,
            status: status,
            json: async function readBody() {
                return {};
            },
            text: async function readText() {
                return 'boom';
            },
        };
    });
    vi.stubGlobal('fetch', fetchStub);
}

function currentFetchStub(): ReturnType<typeof vi.fn> {
    return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function findRecorded(googleEventId: string): RecordedEvent {
    for (const recorded of state.upsertedEvents) {
        if (recorded.googleEventId === googleEventId) {
            return recorded;
        }
    }
    throw new Error('저장되지 않았습니다: ' + googleEventId);
}

beforeEach(function resetState() {
    state.closingRow = null;
    state.memberRow = { googleScopeLevel: 'CALENDAR_READ', googleRefreshToken: 'encrypted-blob' };
    state.colorMappingRows = [];
    state.existingEvents = new Map();
    state.upsertedEvents = [];
    state.deletedEventFilters = [];
    state.upsertedClosings = [];

    mocks.decryptRefreshToken.mockReturnValue('plain-refresh-token');
    mocks.refreshAccessToken.mockResolvedValue('access-token');
    stubGoogleEvents([]);
});

afterEach(function clearStubs() {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

/** 시각이 있는 일반 일정 하나 */
function timedEvent(overrides: Record<string, unknown>): Record<string, unknown> {
    const base = {
        id: 'evt-timed',
        summary: '설계 리뷰',
        start: { dateTime: '2026-08-18T10:00:00+09:00' },
        end: { dateTime: '2026-08-18T11:00:00+09:00' },
    };
    return { ...base, ...overrides };
}

/** 종일 일정 하나 — 구글은 dateTime 없이 date 만 준다 */
function allDayEvent(): Record<string, unknown> {
    return {
        id: 'evt-allday',
        summary: '휴가',
        start: { date: '2026-08-18' },
        end: { date: '2026-08-19' },
    };
}

describe('동결된 주 (테스트계획 #28)', () => {
    it('⭐ 마감된 주는 구글을 부르지 않는다 — 호출 자체가 발생하지 않아야 한다', async () => {
        state.closingRow = { closingStatus: 'CLOSED', calendarSyncResult: 'SYNCED' };

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.importedCount).toBe(0);
        // "안 읽었다"가 아니라 **"읽을 코드 경로가 없다"** 를 지킨다 (정책 §3.2)
        expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
        expect(currentFetchStub()).not.toHaveBeenCalled();
        expect(state.upsertedEvents).toHaveLength(0);
        expect(state.upsertedClosings).toHaveLength(0);
    });

    it('마감된 주의 상태는 마감 당시 기록을 그대로 돌려준다', async () => {
        state.closingRow = { closingStatus: 'CLOSED', calendarSyncResult: 'FAILED' };

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.status).toBe('FAILED');
    });

    it('OPEN 인 주는 정상적으로 읽는다', async () => {
        state.closingRow = { closingStatus: 'OPEN', calendarSyncResult: 'SYNCED' };
        stubGoogleEvents([timedEvent({})]);

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.status).toBe('SYNCED');
        expect(result.importedCount).toBe(1);
    });
});

describe('연동·토큰 실패 (테스트계획 #26 · #27)', () => {
    it('구글 연동이 없으면 NOT_CONNECTED — 실패가 아니다', async () => {
        state.memberRow = { googleScopeLevel: 'NONE', googleRefreshToken: null };

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.status).toBe('NOT_CONNECTED');
        expect(currentFetchStub()).not.toHaveBeenCalled();
    });

    it('⭐ 토큰이 만료되면 FAILED — 조용히 0건 성공으로 넘어가지 않는다 (정책 §3.4)', async () => {
        mocks.refreshAccessToken.mockResolvedValue(null);

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.status).toBe('FAILED');
        expect(result.importedCount).toBe(0);
        // 실패했는데 SYNCED 로 마감 상태를 갱신하면 리포트가 거짓말한다
        expect(state.upsertedClosings).toHaveLength(0);
    });

    it('리프레시 토큰 복호화가 실패해도 FAILED — 키가 바뀐 상태다', async () => {
        mocks.decryptRefreshToken.mockReturnValue(null);

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.status).toBe('FAILED');
        expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('구글이 5xx 를 주면 FAILED', async () => {
        stubGoogleFailure(503);

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.status).toBe('FAILED');
        expect(state.upsertedEvents).toHaveLength(0);
    });
});

describe('필터 7종이 DB 행까지 도달한다 (테스트계획 §5)', () => {
    it('#31 종일 일정 → ALL_DAY 로 제외된다', async () => {
        stubGoogleEvents([allDayEvent()]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        const recorded = findRecorded('evt-allday');
        expect(recorded.excludedFromStatistics).toBe(true);
        expect(recorded.exclusionReason).toBe('ALL_DAY');
    });

    it('#32 내가 거절한 회의 → DECLINED 로 제외된다', async () => {
        stubGoogleEvents([
            timedEvent({
                id: 'evt-declined',
                attendees: [{ self: true, responseStatus: 'declined' }],
            }),
        ]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-declined').exclusionReason).toBe('DECLINED');
    });

    it('남이 거절한 회의는 내 일정이다 — 제외되지 않는다', async () => {
        stubGoogleEvents([
            timedEvent({
                id: 'evt-others-declined',
                attendees: [{ self: false, responseStatus: 'declined' }],
            }),
        ]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-others-declined').exclusionReason).toBeNull();
    });

    it('#33 9시간짜리 일정 → TOO_LONG 으로 제외된다', async () => {
        stubGoogleEvents([
            timedEvent({
                id: 'evt-long',
                start: { dateTime: '2026-08-18T09:00:00+09:00' },
                end: { dateTime: '2026-08-18T18:00:00+09:00' },
            }),
        ]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-long').exclusionReason).toBe('TOO_LONG');
    });

    it('⭐ #34 NFS 가 쓴 일정 → NFS_ORIGIN 으로 제외된다 (에코 루프 차단)', async () => {
        stubGoogleEvents([
            timedEvent({
                id: 'evt-echo',
                extendedProperties: { private: { nfsBlockId: '12345' } },
            }),
        ]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-echo').exclusionReason).toBe('NFS_ORIGIN');
    });

    it('⭐ #35 사용자가 끈 일정은 동기화가 되살리지 않는다 (정책 §4.2 #6)', async () => {
        state.existingEvents.set('evt-timed', {
            excludedFromStatistics: true,
            exclusionReason: 'USER',
        });
        // 필터로만 보면 통과하는 평범한 일정이다. 그래도 사용자의 결정이 이겨야 한다
        stubGoogleEvents([timedEvent({})]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        const recorded = findRecorded('evt-timed');
        expect(recorded.excludedFromStatistics).toBe(true);
        expect(recorded.exclusionReason).toBe('USER');
    });

    it('사용자가 켜둔 일정에는 필터 판정이 그대로 적용된다', async () => {
        state.existingEvents.set('evt-echo', {
            excludedFromStatistics: false,
            exclusionReason: null,
        });
        stubGoogleEvents([
            timedEvent({ id: 'evt-echo', extendedProperties: { private: { nfsBlockId: '1' } } }),
        ]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-echo').exclusionReason).toBe('NFS_ORIGIN');
    });

    it('#36 색상이 없으면 미분류로 수집한다 — 버리지 않는다', async () => {
        stubGoogleEvents([timedEvent({})]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        const recorded = findRecorded('evt-timed');
        expect(recorded.mappedCategoryTag).toBe('UNCATEGORIZED');
        expect(recorded.excludedFromStatistics).toBe(false);
    });

    it('#38 색상 매핑이 있으면 그 태그로 들어온다', async () => {
        state.colorMappingRows = [{ googleColorId: '9', categoryTag: 'DEVELOPMENT' }];
        stubGoogleEvents([timedEvent({ colorId: '9' })]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-timed').mappedCategoryTag).toBe('DEVELOPMENT');
    });

    it('제목이 없으면 "(제목 없음)" 으로 남는다 — 화면이 빈 줄을 그리지 않게', async () => {
        stubGoogleEvents([timedEvent({ summary: undefined })]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-timed').title).toBe('(제목 없음)');
    });

    it('취소된 일정은 저장하지 않는다', async () => {
        stubGoogleEvents([timedEvent({ id: 'evt-cancelled', status: 'cancelled' })]);

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(state.upsertedEvents).toHaveLength(0);
        expect(result.importedCount).toBe(0);
    });

    it('시각이 깨진 일정 하나가 동기화 전체를 막지 않는다', async () => {
        stubGoogleEvents([
            { id: 'evt-broken', summary: '깨짐', start: {}, end: {} },
            timedEvent({}),
        ]);

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.status).toBe('SYNCED');
        expect(result.importedCount).toBe(1);
        expect(findRecorded('evt-timed')).toBeDefined();
    });

    it('제외된 일정도 저장은 된다 — importedCount 에 포함되고 excludedCount 로 따로 센다', async () => {
        stubGoogleEvents([timedEvent({}), allDayEvent()]);

        const result = await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(result.importedCount).toBe(2);
        expect(result.excludedCount).toBe(1);
    });
});

describe('⭐ 타임존 — 프로세스 존이 답을 바꾸지 않는다 (테스트계획 §6)', () => {
    it('프로세스 존이 무엇이든 앱 존은 KST 다', () => {
        // ⚠️ **프로세스 존을 단언하지 않는다.** 여기서 UTC 를 못 박으면
        //    `pnpm test:tz`(#39-b)가 존을 바꿔 돌릴 때 이 테스트만 깨진다 —
        //    검증하려는 성질은 "UTC 에서 돈다"가 아니라 **"존을 바꿔도 답이 같다"** 다.
        const weekStart = parseAppDate('2026-08-17');

        expect(weekStart.zoneName).toBe('Asia/Seoul');
        expect(weekStart.offset).toBe(540);
        expect(weekStart.hour).toBe(0);
    });

    it('구글에 보내는 조회 구간이 KST 자정 기준이다 — 프로세스 존을 따라가지 않는다', async () => {
        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        const firstCall = currentFetchStub().mock.calls[0];
        const requestUrl = String(firstCall[0]);

        // 2026-08-17 00:00 KST ~ 2026-08-24 00:00 KST
        expect(requestUrl).toContain(encodeURIComponent('2026-08-17T00:00:00.000+09:00'));
        expect(requestUrl).toContain(encodeURIComponent('2026-08-24T00:00:00.000+09:00'));
        expect(requestUrl).toContain('singleEvents=true');
    });

    it('구글이 UTC(Z) 로 준 시각도 같은 순간으로 저장된다', async () => {
        // 2026-08-18T01:00Z = 한국 10:00
        stubGoogleEvents([
            timedEvent({
                start: { dateTime: '2026-08-18T01:00:00Z' },
                end: { dateTime: '2026-08-18T02:00:00Z' },
            }),
        ]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        const storedStart = instantFromColumn(findRecorded('evt-timed').startTime);
        expect(storedStart.hour).toBe(10);
        expect(storedStart.toFormat('yyyy-MM-dd')).toBe('2026-08-18');
    });

    it('종일 일정의 날짜를 UTC 자정으로 읽지 않는다 — 한국 자정이어야 한다', async () => {
        stubGoogleEvents([allDayEvent()]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        const storedStart = instantFromColumn(findRecorded('evt-allday').startTime);
        // raw Date 로 파싱했다면 한국 09:00 이 됐을 자리다
        expect(storedStart.hour).toBe(0);
        expect(storedStart.toFormat('yyyy-MM-dd')).toBe('2026-08-18');
    });

    it('주 시작일 컬럼이 UTC 자정으로 저장된다 (DATE 컬럼 규약)', async () => {
        stubGoogleEvents([timedEvent({})]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(findRecorded('evt-timed').weekStartDate.toISOString()).toBe(
            '2026-08-17T00:00:00.000Z',
        );
    });
});

describe('정리와 마감 행 (N-032 수집 경로 ①)', () => {
    it('구글에서 사라진 일정을 지운다 — 안 지우면 예산을 계속 갉아먹는다', async () => {
        stubGoogleEvents([timedEvent({})]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(state.deletedEventFilters).toHaveLength(1);
        expect(state.deletedEventFilters[0]).toMatchObject({
            where: { googleEventId: { notIn: ['evt-timed'] } },
        });
    });

    it('동기화가 끝나면 weekly_closing 을 OPEN·SYNCED 로 남긴다 — 마감 배치가 이걸 보고 대상을 고른다', async () => {
        stubGoogleEvents([timedEvent({})]);

        await syncCalendarWeek(MEMBER_ID, WEEK_START, NOW);

        expect(state.upsertedClosings).toHaveLength(1);
        expect(state.upsertedClosings[0]).toMatchObject({
            create: { closingStatus: 'OPEN', calendarSyncResult: 'SYNCED', importedEventCount: 1 },
            update: { calendarSyncResult: 'SYNCED', importedEventCount: 1 },
        });
    });
});
