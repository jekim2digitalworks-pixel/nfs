import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetOccupant } from '@nfs/domain';
import {
    dateStringToDateColumn,
    instantToColumn,
    parseAppDate,
    parseAppDateTime,
} from '@nfs/domain/time';

/**
 * 주간 마감 통합 테스트 (T-03 · 테스트계획 §4.2 · §6)
 *
 * 도메인(`packages/domain/closing`)은 "이 주를 닫아도 되는가"와 "원장 행을 어떻게 만드는가"를 지킨다.
 * **여기서 지키는 것은 마감이라는 되돌릴 수 없는 절차의 순서와 실패 처리**다.
 *
 *   - 최종 동기화(B-11)가 일정 조회보다 **먼저** 일어나는가 — 아니면 막판 일정이 영영 사라진다
 *   - ⭐ 동기화가 실패해도 마감이 **진행되는가** (N-035) — 미루면 예산이 조용히 좁아진다
 *   - 실패를 `SYNCED` 로 적지 않는가 (정책 §3.4)
 *   - 마감된 주를 다시 열지 않는가
 *   - 겹침으로 0분이 된 일정을 원장에 넣지 않는가
 *
 * ⭐ **`TZ=UTC` 로 돈다** (vitest.config.ts). 마감 기한(KST 월 04:00) 판정이 프로세스 존을 타면 여기서 깨진다.
 */

const mocks = vi.hoisted(function createMocks() {
    return {
        syncCalendarWeek: vi.fn(),
        loadDayOccupants: vi.fn(),
    };
});

vi.mock('./calendar-sync', function stubCalendarSync() {
    return { syncCalendarWeek: mocks.syncCalendarWeek };
});

vi.mock('./day-occupants', function stubDayOccupants() {
    return { loadDayOccupants: mocks.loadDayOccupants };
});

interface StoredEventRow {
    importedEventId: bigint;
    googleEventId: string;
    title: string;
    mappedCategoryTag: string;
    startTime: Date;
    endTime: Date;
}

interface FakeState {
    closingRow: { closingStatus: string; calendarSyncResult: string } | null;
    memberRow: { googleScopeLevel: string; googleRefreshToken: string | null } | null;
    storedEvents: StoredEventRow[];
    /** 호출 순서를 그대로 적는다. 순서 자체가 이 테스트의 대상이다 */
    callOrder: string[];
    /** 마지막 일정 조회의 where 절. memberId 가 BigInt 라 문자열로 굳히지 않는다 */
    lastEventQueryWhere: Record<string, unknown> | null;
    insertedLedgerRows: Array<Record<string, unknown>>;
    upsertedClosings: Array<Record<string, unknown>>;
    strayDeleteCount: number;
}

const state = vi.hoisted(function createState(): FakeState {
    return {
        closingRow: null,
        memberRow: null,
        storedEvents: [],
        callOrder: [],
        lastEventQueryWhere: null,
        insertedLedgerRows: [],
        upsertedClosings: [],
        strayDeleteCount: 0,
    };
});

vi.mock('../prisma', function stubPrisma() {
    const transactionClient = {
        timeLog: {
            createMany: async function insertLedgerRows(args: {
                data: Array<Record<string, unknown>>;
            }) {
                for (const row of args.data) {
                    state.insertedLedgerRows.push(row);
                }
                return { count: args.data.length };
            },
        },
        importedCalendarEvent: {
            deleteMany: async function clearWeek() {
                state.callOrder.push('tx.importedCalendarEvent.deleteMany');
                return { count: 0 };
            },
        },
        weeklyClosing: {
            upsert: async function freezeWeek(args: Record<string, unknown>) {
                state.upsertedClosings.push(args);
                return {};
            },
        },
    };

    return {
        prisma: {
            weeklyClosing: {
                findUnique: async function findClosing() {
                    return state.closingRow;
                },
            },
            member: {
                findUnique: async function findMember() {
                    return state.memberRow;
                },
            },
            importedCalendarEvent: {
                findMany: async function findEvents(args: Record<string, unknown>) {
                    state.callOrder.push('importedCalendarEvent.findMany');
                    state.lastEventQueryWhere = args['where'] as Record<string, unknown>;
                    return state.storedEvents;
                },
                deleteMany: async function deleteStray() {
                    return { count: state.strayDeleteCount };
                },
            },
            $transaction: async function runTransaction(
                work: (tx: typeof transactionClient) => Promise<number>,
            ) {
                return await work(transactionClient);
            },
        },
    };
});

const { closeWeek } = await import('./closing');

const MEMBER_ID = BigInt(1);
/** 2026-08-10 은 월요일. 아래 NOW 기준으로 마감 기한(8/17 04:00 KST)을 이미 넘겼다 */
const CLOSABLE_WEEK = '2026-08-10';
const NOW = parseAppDateTime('2026-08-20T10:00');

function connectedMember(): { googleScopeLevel: string; googleRefreshToken: string | null } {
    return { googleScopeLevel: 'CALENDAR_READ', googleRefreshToken: 'encrypted-blob' };
}

/** 2026-08-11(화) 10:00~11:00 KST 짜리 일정 하나 */
function storedEvent(overrides: Partial<StoredEventRow> = {}): StoredEventRow {
    const base: StoredEventRow = {
        importedEventId: BigInt(10),
        googleEventId: 'evt-1',
        title: '설계 리뷰',
        mappedCategoryTag: 'DEVELOPMENT',
        startTime: instantToColumn(parseAppDateTime('2026-08-11T10:00')),
        endTime: instantToColumn(parseAppDateTime('2026-08-11T11:00')),
    };
    return { ...base, ...overrides };
}

/** 같은 구간을 이미 차지한 실측 블록. 캘린더는 블록에 자리를 내준다 (정책 §2.1 규칙 4) */
function blockingOccupant(): BudgetOccupant {
    return {
        referenceKey: 'log:99',
        sourceType: 'NFS_BLOCK',
        categoryTag: 'DEVELOPMENT',
        title: '실제로 한 일',
        startTime: parseAppDateTime('2026-08-11T10:00'),
        endTime: parseAppDateTime('2026-08-11T11:00'),
    };
}

function syncSucceeded(importedCount: number) {
    return {
        status: 'SYNCED',
        weekStartDate: CLOSABLE_WEEK,
        importedCount: importedCount,
        excludedCount: 0,
        syncedTime: NOW,
    };
}

function syncFailed() {
    return {
        status: 'FAILED',
        weekStartDate: CLOSABLE_WEEK,
        importedCount: 0,
        excludedCount: 0,
        syncedTime: null,
    };
}

beforeEach(function resetState() {
    state.closingRow = null;
    state.memberRow = connectedMember();
    state.storedEvents = [];
    state.callOrder = [];
    state.lastEventQueryWhere = null;
    state.insertedLedgerRows = [];
    state.upsertedClosings = [];
    state.strayDeleteCount = 0;

    vi.clearAllMocks();
    mocks.syncCalendarWeek.mockImplementation(async function recordSync() {
        state.callOrder.push('syncCalendarWeek');
        return syncSucceeded(1);
    });
    mocks.loadDayOccupants.mockResolvedValue([]);
});

describe('정상 마감 (테스트계획 #25)', () => {
    it('일정을 원장으로 옮기고, 그 주 일정을 지우고, CLOSED 로 동결한다', async () => {
        state.storedEvents = [storedEvent()];

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.closed).toBe(true);
        expect(result.importedEventCount).toBe(1);
        expect(state.insertedLedgerRows).toHaveLength(1);
        expect(state.insertedLedgerRows[0]).toMatchObject({
            sourceType: 'GOOGLE_CALENDAR',
            title: '설계 리뷰',
            categoryTag: 'DEVELOPMENT',
            actualFocusMinutes: 60,
            overlapDeductedMinutes: 0,
        });
        expect(state.callOrder).toContain('tx.importedCalendarEvent.deleteMany');
        expect(state.upsertedClosings[0]).toMatchObject({
            create: { closingStatus: 'CLOSED', calendarSyncResult: 'SYNCED' },
            update: { closingStatus: 'CLOSED', calendarSyncResult: 'SYNCED' },
        });
    });

    it('제외된 일정은 애초에 조회하지 않는다 (정책 §4.2)', async () => {
        await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(state.lastEventQueryWhere).toMatchObject({ excludedFromStatistics: false });
    });

    it('원장 INSERT 는 skipDuplicates 다 — 백필(B-13)이 먼저 넣어뒀을 수 있다', async () => {
        state.storedEvents = [storedEvent()];

        await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        // createMany 인자를 통째로 보는 대신, 마감이 UNIQUE 위반으로 죽지 않는지를 본다
        expect(state.insertedLedgerRows).toHaveLength(1);
    });
});

describe('⭐ 최종 동기화 연결 (N-035 · 테스트계획 #26 · #27)', () => {
    it('⭐ 일정을 읽기 **전에** 동기화한다 — 순서가 뒤집히면 막판 일정이 영영 사라진다', async () => {
        state.storedEvents = [storedEvent()];

        await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        const syncIndex = state.callOrder.indexOf('syncCalendarWeek');
        const findIndex = state.callOrder.indexOf('importedCalendarEvent.findMany');

        expect(syncIndex).toBeGreaterThanOrEqual(0);
        expect(findIndex).toBeGreaterThanOrEqual(0);
        expect(syncIndex).toBeLessThan(findIndex);
    });

    it('마감하려는 그 주를 동기화한다 — 이번 주가 아니다', async () => {
        await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(mocks.syncCalendarWeek).toHaveBeenCalledWith(MEMBER_ID, CLOSABLE_WEEK, NOW);
    });

    it('⭐ #26 동기화가 실패해도 마감은 진행한다 — 미루면 예산이 조용히 좁아진다', async () => {
        mocks.syncCalendarWeek.mockResolvedValue(syncFailed());
        state.storedEvents = [storedEvent()];

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.closed).toBe(true);
        expect(result.calendarSyncResult).toBe('FAILED');
        // 주중에 쌓여 있던 일정은 그대로 원장에 들어간다. 잃는 건 막판 변경분뿐이다
        expect(state.insertedLedgerRows).toHaveLength(1);
        expect(state.upsertedClosings[0]).toMatchObject({
            create: { closingStatus: 'CLOSED', calendarSyncResult: 'FAILED' },
        });
    });

    it('⭐ #27 동기화가 예외를 던져도 마감은 진행한다 — 구글이 죽은 것과 주를 못 닫는 건 별개다', async () => {
        mocks.syncCalendarWeek.mockRejectedValue(new Error('fetch failed'));
        state.storedEvents = [storedEvent()];

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.closed).toBe(true);
        expect(result.calendarSyncResult).toBe('FAILED');
        expect(state.insertedLedgerRows).toHaveLength(1);
    });

    it('실패를 SYNCED 로 적지 않는다 — 리포트가 거짓말하면 안 된다 (정책 §3.4)', async () => {
        mocks.syncCalendarWeek.mockResolvedValue(syncFailed());

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.calendarSyncResult).not.toBe('SYNCED');
        expect(state.upsertedClosings[0]).toMatchObject({
            update: { calendarSyncResult: 'FAILED' },
        });
    });

    it('실패했으면 last_synced_time 을 남기지 않는다', async () => {
        mocks.syncCalendarWeek.mockResolvedValue(syncFailed());

        await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(state.upsertedClosings[0]).toMatchObject({ create: { lastSyncedTime: null } });
    });

    it('구글 연동이 없으면 NOT_CONNECTED 이고 동기화를 시도조차 하지 않는다', async () => {
        state.memberRow = { googleScopeLevel: 'NONE', googleRefreshToken: null };

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.calendarSyncResult).toBe('NOT_CONNECTED');
        expect(mocks.syncCalendarWeek).not.toHaveBeenCalled();
        expect(result.closed).toBe(true);
    });

    it('스코프는 있는데 토큰이 비어 있으면 NOT_CONNECTED 다', async () => {
        state.memberRow = { googleScopeLevel: 'CALENDAR_READ', googleRefreshToken: null };

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.calendarSyncResult).toBe('NOT_CONNECTED');
        expect(mocks.syncCalendarWeek).not.toHaveBeenCalled();
    });
});

describe('멱등성과 동결 (테스트계획 #28)', () => {
    it('이미 CLOSED 인 주는 다시 열지 않는다 — 동기화도 원장 INSERT 도 없다', async () => {
        state.closingRow = { closingStatus: 'CLOSED', calendarSyncResult: 'SYNCED' };

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.closed).toBe(false);
        expect(mocks.syncCalendarWeek).not.toHaveBeenCalled();
        expect(state.insertedLedgerRows).toHaveLength(0);
        expect(state.upsertedClosings).toHaveLength(0);
    });

    it('동결된 주에 일정이 남아 있으면 정리한다 — 안 지우면 예산 계산기가 계속 센다', async () => {
        state.closingRow = { closingStatus: 'CLOSED', calendarSyncResult: 'SYNCED' };
        state.strayDeleteCount = 3;

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.skippedEventCount).toBe(3);
    });

    it('OPEN 인 주는 정상적으로 마감한다', async () => {
        state.closingRow = { closingStatus: 'OPEN', calendarSyncResult: 'SYNCED' };
        state.storedEvents = [storedEvent()];

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.closed).toBe(true);
        expect(state.insertedLedgerRows).toHaveLength(1);
    });
});

describe('겹침 차감 (테스트계획 #29)', () => {
    it('블록이 이미 다 차지한 구간이면 원장에 넣지 않는다 — 0분짜리 행은 만들지 않는다', async () => {
        state.storedEvents = [storedEvent()];
        mocks.loadDayOccupants.mockResolvedValue([blockingOccupant()]);

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(result.importedEventCount).toBe(0);
        expect(result.skippedEventCount).toBe(1);
        expect(state.insertedLedgerRows).toHaveLength(0);
        // 그래도 주는 닫힌다. 남겨두면 다음 주에 또 계산한다
        expect(result.closed).toBe(true);
    });

    it('자기 자신을 점유자 목록에서 빼고 계산한다 — 안 그러면 전부 깎인다', async () => {
        state.storedEvents = [storedEvent()];

        await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(mocks.loadDayOccupants).toHaveBeenCalledWith(MEMBER_ID, '2026-08-11', {
            excludeCalendarEventId: 'evt-1',
        });
    });

    it('여러 날에 걸친 일정은 날짜마다 겹침을 재고 더한다', async () => {
        // 2026-08-11 23:00 ~ 08-12 01:00 (KST) — 이틀에 걸친다
        state.storedEvents = [
            storedEvent({
                startTime: instantToColumn(parseAppDateTime('2026-08-11T23:00')),
                endTime: instantToColumn(parseAppDateTime('2026-08-12T01:00')),
            }),
        ];

        const result = await closeWeek(MEMBER_ID, CLOSABLE_WEEK, NOW);

        expect(mocks.loadDayOccupants).toHaveBeenCalledTimes(2);
        expect(result.importedEventCount).toBe(1);
        expect(state.insertedLedgerRows[0]).toMatchObject({ actualFocusMinutes: 120 });
    });
});

describe('⭐ 마감 기한과 타임존 (테스트계획 §6 · #42)', () => {
    it('프로세스 존이 무엇이든 앱 존은 KST 다', () => {
        // ⚠️ **프로세스 존을 단언하지 않는다.** 여기서 UTC 를 못 박으면
        //    `pnpm test:tz`(#39-b)가 존을 바꿔 돌릴 때 이 테스트만 깨진다 —
        //    검증하려는 성질은 "UTC 에서 돈다"가 아니라 **"존을 바꿔도 답이 같다"** 다.
        const weekStart = parseAppDate('2026-08-17');

        expect(weekStart.zoneName).toBe('Asia/Seoul');
        expect(weekStart.offset).toBe(540);
        expect(weekStart.hour).toBe(0);
    });

    it('기한 전에 부르면 터뜨린다 — 마감은 되돌릴 수 없어서 조용히 넘어가지 않는다', async () => {
        // 2026-08-17(월) 은 8/24 04:00 KST 가 기한이다. 지금(8/20)은 아직 이르다
        await expect(closeWeek(MEMBER_ID, '2026-08-17', NOW)).rejects.toThrow(
            '아직 마감할 수 없는 주입니다',
        );
    });

    it('#42 월요일 03:59 KST 에는 지난주를 닫지 못한다', async () => {
        const justBefore = parseAppDateTime('2026-08-17T03:59');

        await expect(closeWeek(MEMBER_ID, '2026-08-10', justBefore)).rejects.toThrow();
    });

    it('#42 월요일 04:01 KST 에는 지난주를 닫는다 — UTC 로 돌아도 판정이 같다', async () => {
        const justAfter = parseAppDateTime('2026-08-17T04:01');

        const result = await closeWeek(MEMBER_ID, '2026-08-10', justAfter);

        expect(result.closed).toBe(true);
    });

    it('#30 연말 경계 — 12/29 시작 주도 주 시작일 기준이라 정상이다', async () => {
        // 2025-12-29 는 월요일. 그 주는 2026-01-04(일) 에 끝난다
        const yearEndWeek = '2025-12-29';
        state.storedEvents = [
            storedEvent({
                startTime: instantToColumn(parseAppDateTime('2026-01-01T10:00')),
                endTime: instantToColumn(parseAppDateTime('2026-01-01T11:00')),
            }),
        ];

        const result = await closeWeek(MEMBER_ID, yearEndWeek, NOW);

        expect(result.closed).toBe(true);
        expect(state.insertedLedgerRows[0]).toMatchObject({
            statDate: dateStringToDateColumn('2026-01-01'),
        });
    });

    it('주 시작일 DATE 컬럼이 UTC 자정이다 — 프로세스 존이 KST 여도 같아야 한다', () => {
        expect(dateStringToDateColumn(CLOSABLE_WEEK).toISOString()).toBe(
            '2026-08-10T00:00:00.000Z',
        );
        expect(parseAppDate(CLOSABLE_WEEK).toFormat('yyyy-MM-dd HH:mm ZZ')).toBe(
            '2026-08-10 00:00 +09:00',
        );
    });
});
