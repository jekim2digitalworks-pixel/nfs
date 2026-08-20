import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetOccupant } from '@nfs/domain';
import {
    dateStringToDateColumn,
    instantFromColumn,
    instantToColumn,
    parseAppDateTime,
} from '@nfs/domain/time';

/**
 * 자정 정산 통합 테스트 (T-03 · 테스트계획 §4.1 · §6)
 *
 * 도메인(`packages/domain/block`)은 "무엇을 기록할지"를 이미 지킨다.
 * **여기서 지키는 것은 되돌릴 수 없는 이관을 몇 번 돌려도 같은가**다.
 *
 *   - INSERT 가 DELETE 보다 **먼저**인가 — 반대면 중간에 끊길 때 기록이 사라진다
 *   - 두 번 돌려도 원장이 부풀지 않는가 (멱등)
 *   - 한 명이 막혀도 나머지가 도는가
 *   - ⭐ 대상이 "어제"가 아니라 **"오늘 이전 전부"** 인가 (N-031)
 *   - ⭐ 오늘 것은 절대 건드리지 않는가 — 지금 돌고 있는 블록을 죽이는 일이다
 *
 * ⭐ **`TZ=UTC` 가 기본이고, `pnpm test:tz` 가 세 존으로 다시 돌린다** (#39-b).
 *    "오늘(KST)"의 경계가 프로세스 존을 타면 여기서 깨진다.
 */

const mocks = vi.hoisted(function createMocks() {
    return { loadDayOccupants: vi.fn() };
});

vi.mock('./day-occupants', function stubDayOccupants() {
    return { loadDayOccupants: mocks.loadDayOccupants };
});

interface ActiveBlockRow {
    activeBlockId: bigint;
    memberId: bigint;
    title: string;
    categoryTag: string;
    blockStatus: string;
    plannedStartTime: Date;
    plannedMinutes: number;
    actualStartTime: Date | null;
    accumulatedFocusSeconds: number;
    lastResumedTime: Date | null;
    pauseCount: number;
    workDate: Date;
}

interface FakeState {
    blocks: ActiveBlockRow[];
    /** 원장에 이미 있는 멱등성 키. 두 번째 정산이 여기 걸려 건너뛴다 */
    existingLedgerKeys: Set<string>;
    insertedLedgerRows: Array<Record<string, unknown>>;
    deletedBlockIds: string[];
    callOrder: string[];
    /** 이 회원의 블록을 읽을 때 터뜨린다 — 회원 단위 격리를 보기 위한 것 */
    throwForMemberId: string | null;
}

const state = vi.hoisted(function createState(): FakeState {
    return {
        blocks: [],
        existingLedgerKeys: new Set(),
        insertedLedgerRows: [],
        deletedBlockIds: [],
        callOrder: [],
        throwForMemberId: null,
    };
});

vi.mock('../prisma', function stubPrisma() {
    const transactionClient = {
        timeLog: {
            createMany: async function insertLedgerRows(args: {
                data: Array<Record<string, unknown>>;
            }) {
                state.callOrder.push('timeLog.createMany');

                let inserted = 0;
                for (const row of args.data) {
                    const key = String(row['sourceReferenceKey']);

                    // skipDuplicates = ON CONFLICT DO NOTHING. UNIQUE 제약을 흉내 낸다
                    if (state.existingLedgerKeys.has(key)) {
                        continue;
                    }
                    state.existingLedgerKeys.add(key);
                    state.insertedLedgerRows.push(row);
                    inserted = inserted + 1;
                }
                return { count: inserted };
            },
        },
        activeBlock: {
            deleteMany: async function removeBlock(args: {
                where: { activeBlockId: bigint };
            }) {
                state.callOrder.push('activeBlock.deleteMany');

                const targetId = args.where.activeBlockId.toString();
                state.deletedBlockIds.push(targetId);

                const remaining: ActiveBlockRow[] = [];
                for (const block of state.blocks) {
                    if (block.activeBlockId.toString() !== targetId) {
                        remaining.push(block);
                    }
                }
                state.blocks = remaining;
                return { count: 1 };
            },
        },
    };

    return {
        prisma: {
            activeBlock: {
                findFirst: async function findBlock(args: {
                    where: { activeBlockId: bigint; memberId: bigint };
                }) {
                    for (const block of state.blocks) {
                        const idMatches =
                            block.activeBlockId === args.where.activeBlockId &&
                            block.memberId === args.where.memberId;

                        if (idMatches) {
                            return block;
                        }
                    }
                    return null;
                },
                findMany: async function findBlocksOfDate(args: {
                    where: { memberId: bigint; workDate: Date };
                }) {
                    const memberIdText = args.where.memberId.toString();

                    if (state.throwForMemberId === memberIdText) {
                        throw new Error('connection lost');
                    }

                    const matched: Array<{ activeBlockId: bigint }> = [];
                    for (const block of state.blocks) {
                        const sameMember = block.memberId === args.where.memberId;
                        const sameDate =
                            block.workDate.getTime() === args.where.workDate.getTime();

                        if (sameMember && sameDate) {
                            matched.push({ activeBlockId: block.activeBlockId });
                        }
                    }
                    return matched;
                },
                groupBy: async function groupTargets(args: {
                    where: { workDate: { lt: Date } };
                }) {
                    const seen = new Map<string, { memberId: bigint; workDate: Date }>();

                    for (const block of state.blocks) {
                        if (block.workDate.getTime() >= args.where.workDate.lt.getTime()) {
                            continue;
                        }
                        const key = block.memberId.toString() + ':' + block.workDate.toISOString();

                        if (!seen.has(key)) {
                            seen.set(key, { memberId: block.memberId, workDate: block.workDate });
                        }
                    }
                    return Array.from(seen.values());
                },
            },
            $transaction: async function runTransaction(
                work: (tx: typeof transactionClient) => Promise<boolean>,
            ) {
                return await work(transactionClient);
            },
        },
    };
});

const { settleActiveBlock, runDailySettlement } = await import('./settlement');

const MEMBER_ID = BigInt(1);
const OTHER_MEMBER_ID = BigInt(2);
/** 자정 배치가 도는 시각 — KST 08-20 00:05 (크론은 UTC 로 15:05 에 뜬다) */
const BATCH_NOW = parseAppDateTime('2026-08-20T00:05');

/** 어제(08-19) 22:00 에 시작해 아직 RUNNING 인 60분 블록 */
function runningBlockFromYesterday(overrides: Partial<ActiveBlockRow> = {}): ActiveBlockRow {
    const base: ActiveBlockRow = {
        activeBlockId: BigInt(100),
        memberId: MEMBER_ID,
        title: '설계 정리',
        categoryTag: 'DEVELOPMENT',
        blockStatus: 'RUNNING',
        plannedStartTime: instantToColumn(parseAppDateTime('2026-08-19T22:00')),
        plannedMinutes: 60,
        actualStartTime: instantToColumn(parseAppDateTime('2026-08-19T22:00')),
        accumulatedFocusSeconds: 0,
        lastResumedTime: instantToColumn(parseAppDateTime('2026-08-19T22:00')),
        pauseCount: 0,
        workDate: dateStringToDateColumn('2026-08-19'),
    };
    return { ...base, ...overrides };
}

beforeEach(function resetState() {
    state.blocks = [];
    state.existingLedgerKeys = new Set();
    state.insertedLedgerRows = [];
    state.deletedBlockIds = [];
    state.callOrder = [];
    state.throwForMemberId = null;

    vi.clearAllMocks();
    mocks.loadDayOccupants.mockResolvedValue([]);
});

describe('이관 순서와 멱등성 (테스트계획 #16 · #21 · #24)', () => {
    it('⭐ INSERT 가 DELETE 보다 먼저다 — 반대면 중간에 끊길 때 기록이 사라진다', async () => {
        state.blocks = [runningBlockFromYesterday()];

        await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(state.callOrder).toEqual(['timeLog.createMany', 'activeBlock.deleteMany']);
    });

    it('#21 RUNNING 블록이 자정을 넘기면 AUTO_SETTLED 로 정산된다', async () => {
        state.blocks = [runningBlockFromYesterday()];

        const result = await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(result).not.toBeNull();
        expect(result?.inserted).toBe(true);
        expect(state.insertedLedgerRows[0]).toMatchObject({
            sourceType: 'NFS_BLOCK',
            sourceReferenceKey: '100',
            completionType: 'AUTO_SETTLED',
        });
    });

    it('#22 PAUSED 블록도 같은 방식으로 정산된다', async () => {
        state.blocks = [
            runningBlockFromYesterday({
                blockStatus: 'PAUSED',
                accumulatedFocusSeconds: 25 * 60,
                lastResumedTime: null,
                pauseCount: 1,
            }),
        ];

        const result = await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(result?.inserted).toBe(true);
        expect(state.insertedLedgerRows[0]).toMatchObject({
            completionType: 'AUTO_SETTLED',
            actualFocusMinutes: 25,
            pauseCount: 1,
        });
    });

    it('#24 같은 블록을 두 번 정산해도 원장이 부풀지 않는다', async () => {
        state.blocks = [runningBlockFromYesterday()];

        const first = await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');
        // 블록은 이미 지워졌다. 배치가 다시 돌면 여기로 온다
        const second = await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(first?.inserted).toBe(true);
        expect(second).toBeNull();
        expect(state.insertedLedgerRows).toHaveLength(1);
    });

    it('원장에 이미 같은 키가 있으면 inserted 는 false 다 — 예외가 아니다', async () => {
        state.existingLedgerKeys.add('100');
        state.blocks = [runningBlockFromYesterday()];

        const result = await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(result?.inserted).toBe(false);
        // 그래도 블록은 지운다. 안 지우면 매 배치마다 다시 집는다
        expect(state.deletedBlockIds).toContain('100');
    });

    it('없는 블록을 정산하면 null 이다 — 배치와 사용자 완료가 부딪히는 정상 상황이다', async () => {
        const result = await settleActiveBlock(MEMBER_ID, BigInt(999), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(result).toBeNull();
        expect(state.insertedLedgerRows).toHaveLength(0);
    });

    it('⚠️ 남의 블록은 정산할 수 없다 — URL 의 id 를 신뢰하지 않는다', async () => {
        state.blocks = [runningBlockFromYesterday()];

        const result = await settleActiveBlock(
            OTHER_MEMBER_ID,
            BigInt(100),
            BATCH_NOW,
            'MIDNIGHT_BATCH',
        );

        expect(result).toBeNull();
        expect(state.insertedLedgerRows).toHaveLength(0);
    });
});

describe('겹침 차감 (테스트계획 #20)', () => {
    it('정산 구간이 다른 일정에 이미 먹혔으면 차감분이 남는다', async () => {
        state.blocks = [runningBlockFromYesterday()];
        // 22:00~23:00 을 통째로 차지한 캘린더 일정
        const occupant: BudgetOccupant = {
            referenceKey: 'evt-1',
            sourceType: 'GOOGLE_CALENDAR',
            categoryTag: 'MEETING',
            title: '회식',
            startTime: parseAppDateTime('2026-08-19T22:00'),
            endTime: parseAppDateTime('2026-08-19T23:00'),
        };
        mocks.loadDayOccupants.mockResolvedValue([occupant]);

        const result = await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        // 블록이 캘린더를 이긴다 (정책 §2.1 규칙 4) — 블록의 차감은 0 이다
        expect(result?.overlapDeductedMinutes).toBe(0);
    });

    it('이관 중인 블록 자신은 점유자 목록에서 뺀다 — 안 그러면 자기와 겹친다', async () => {
        state.blocks = [runningBlockFromYesterday()];

        await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(mocks.loadDayOccupants).toHaveBeenCalledWith(MEMBER_ID, '2026-08-19', {
            excludeActiveBlockId: BigInt(100),
        });
    });
});

describe('배치 대상 선정 (N-031 · 테스트계획 #23)', () => {
    it('⭐ 오늘 블록은 절대 건드리지 않는다 — 지금 돌고 있는 블록을 죽이는 일이다', async () => {
        state.blocks = [
            runningBlockFromYesterday({
                activeBlockId: BigInt(200),
                plannedStartTime: instantToColumn(parseAppDateTime('2026-08-20T00:00')),
                actualStartTime: instantToColumn(parseAppDateTime('2026-08-20T00:00')),
                lastResumedTime: instantToColumn(parseAppDateTime('2026-08-20T00:00')),
                workDate: dateStringToDateColumn('2026-08-20'),
            }),
        ];

        const summary = await runDailySettlement(BATCH_NOW);

        expect(summary.settledBlockCount).toBe(0);
        expect(summary.processedMemberCount).toBe(0);
        expect(state.insertedLedgerRows).toHaveLength(0);
    });

    it('⭐ 대상은 "어제"가 아니라 오늘 이전 전부다 — 한 번 걸러도 따라잡는다', async () => {
        state.blocks = [
            runningBlockFromYesterday({ activeBlockId: BigInt(100) }),
            // 사흘 전에 남겨진 블록. "어제만" 이었다면 영원히 남는다
            runningBlockFromYesterday({
                activeBlockId: BigInt(101),
                plannedStartTime: instantToColumn(parseAppDateTime('2026-08-17T22:00')),
                actualStartTime: instantToColumn(parseAppDateTime('2026-08-17T22:00')),
                lastResumedTime: instantToColumn(parseAppDateTime('2026-08-17T22:00')),
                workDate: dateStringToDateColumn('2026-08-17'),
            }),
        ];

        const summary = await runDailySettlement(BATCH_NOW);

        expect(summary.settledBlockCount).toBe(2);
        expect(state.insertedLedgerRows).toHaveLength(2);
    });

    it('#23 한 회원이 터져도 다른 회원은 정상 처리된다', async () => {
        state.blocks = [
            runningBlockFromYesterday({ activeBlockId: BigInt(100), memberId: MEMBER_ID }),
            runningBlockFromYesterday({ activeBlockId: BigInt(300), memberId: OTHER_MEMBER_ID }),
        ];
        state.throwForMemberId = MEMBER_ID.toString();

        const summary = await runDailySettlement(BATCH_NOW);

        expect(summary.failedMemberIds).toEqual([MEMBER_ID.toString()]);
        expect(summary.settledBlockCount).toBe(1);
        expect(state.insertedLedgerRows[0]).toMatchObject({ sourceReferenceKey: '300' });
    });

    it('#24 배치를 두 번 돌려도 결과가 같다', async () => {
        state.blocks = [runningBlockFromYesterday()];

        const first = await runDailySettlement(BATCH_NOW);
        const second = await runDailySettlement(BATCH_NOW);

        expect(first.settledBlockCount).toBe(1);
        expect(second.settledBlockCount).toBe(0);
        expect(second.processedMemberCount).toBe(0);
        expect(state.insertedLedgerRows).toHaveLength(1);
    });

    it('정산할 게 없으면 0건으로 조용히 끝난다 — 그게 정상이다', async () => {
        const summary = await runDailySettlement(BATCH_NOW);

        expect(summary).toMatchObject({
            processedMemberCount: 0,
            settledBlockCount: 0,
            failedMemberIds: [],
            hasMore: false,
        });
    });
});

describe('⭐ 자정 경계와 타임존 (테스트계획 §6 · #40 · #41)', () => {
    it('프로세스 존이 무엇이든 앱 존은 KST 다', () => {
        // ⚠️ 프로세스 존을 단언하지 않는다 — `pnpm test:tz`(#39-b)가 존을 바꿔 돌린다.
        //    지켜야 할 성질은 "UTC 에서 돈다"가 아니라 **"존을 바꿔도 답이 같다"** 다.
        expect(BATCH_NOW.zoneName).toBe('Asia/Seoul');
        expect(BATCH_NOW.offset).toBe(540);
    });

    it('⭐ 종료 시각을 now 로 늘리지 않는다 — 00:05 배치가 어제 22:00 블록을 2시간으로 만들면 안 된다', async () => {
        state.blocks = [runningBlockFromYesterday()];

        await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        const endTime = instantFromColumn(state.insertedLedgerRows[0]['endTime'] as Date);
        // 실제 시작(22:00) + 계획 길이(60분) 에서 멈춘다 (N-030)
        expect(endTime.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-08-19 23:00');
        expect(state.insertedLedgerRows[0]).toMatchObject({ actualFocusMinutes: 60 });
    });

    it('통계 귀속일은 시작한 날이다 — 자정을 넘어도 쪼개지 않는다 (정책 §2.3)', async () => {
        // 23:30 에 시작한 60분 블록. 자정을 넘어 끝난다
        state.blocks = [
            runningBlockFromYesterday({
                plannedStartTime: instantToColumn(parseAppDateTime('2026-08-19T23:30')),
                actualStartTime: instantToColumn(parseAppDateTime('2026-08-19T23:30')),
                lastResumedTime: instantToColumn(parseAppDateTime('2026-08-19T23:30')),
            }),
        ];

        await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(state.insertedLedgerRows[0]).toMatchObject({
            statDate: dateStringToDateColumn('2026-08-19'),
        });
        // 종료는 min(now, 시작+계획) 이다. 배치가 00:05 에 돌았으니 거기서 멈춘다 —
        // 계획 상한(00:30)까지 늘려 적으면 하지 않은 30분을 원장에 새기는 셈이다
        const endTime = instantFromColumn(state.insertedLedgerRows[0]['endTime'] as Date);
        expect(endTime.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-08-20 00:05');
    });

    it('#41 KST 00:01 에 시작한 블록의 귀속일은 그날이다 — UTC 로 읽으면 전날이 된다', async () => {
        const justAfterMidnight = parseAppDateTime('2026-08-19T00:01');
        state.blocks = [
            runningBlockFromYesterday({
                plannedStartTime: instantToColumn(justAfterMidnight),
                actualStartTime: instantToColumn(justAfterMidnight),
                lastResumedTime: instantToColumn(justAfterMidnight),
            }),
        ];

        await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(state.insertedLedgerRows[0]).toMatchObject({
            statDate: dateStringToDateColumn('2026-08-19'),
        });
    });

    it('#40 KST 23:59 에 시작한 블록의 귀속일도 그날이다', async () => {
        const justBeforeMidnight = parseAppDateTime('2026-08-19T23:59');
        state.blocks = [
            runningBlockFromYesterday({
                plannedStartTime: instantToColumn(justBeforeMidnight),
                actualStartTime: instantToColumn(justBeforeMidnight),
                lastResumedTime: instantToColumn(justBeforeMidnight),
            }),
        ];

        await settleActiveBlock(MEMBER_ID, BigInt(100), BATCH_NOW, 'MIDNIGHT_BATCH');

        expect(state.insertedLedgerRows[0]).toMatchObject({
            statDate: dateStringToDateColumn('2026-08-19'),
        });
    });
});
