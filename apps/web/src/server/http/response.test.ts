import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NfsError, budgetExceeded } from '@nfs/domain';
import { fail, ok, toErrorResponse } from './response';

/**
 * 응답 규약을 고정한다.
 *
 * 이 봉투는 프론트의 `lib/api.ts` 가 그대로 신뢰하는 계약이다.
 * 여기가 조용히 바뀌면 모든 화면의 에러 처리가 한꺼번에 깨진다.
 */

async function bodyOf(response: Response): Promise<Record<string, never>> {
    return (await response.json()) as Record<string, never>;
}

describe('성공 봉투', () => {
    it('{ success: true, data } 로 감싼다', async () => {
        const response = ok({ activeBlockId: '812' });

        expect(response.status).toBe(200);
        expect(await bodyOf(response)).toEqual({ success: true, data: { activeBlockId: '812' } });
    });

    it('생성은 201 을 줄 수 있다', async () => {
        expect(ok({}, 201).status).toBe(201);
    });
});

describe('실패 봉투', () => {
    it('{ success: false, error } 로 감싼다', async () => {
        const response = fail('CATEGORY_REQUIRED', '카테고리를 골라주세요', 400);

        expect(response.status).toBe(400);
        expect(await bodyOf(response)).toEqual({
            success: false,
            error: { code: 'CATEGORY_REQUIRED', message: '카테고리를 골라주세요' },
        });
    });

    it('detail 이 없으면 키 자체를 넣지 않는다', async () => {
        const body = await bodyOf(fail('X', 'y', 400));

        expect(body).not.toHaveProperty('error.detail');
    });
});

describe('예외 → 응답 매핑 (아키텍처 §8)', () => {
    it('도메인 에러 코드가 정해진 HTTP 상태로 간다', () => {
        const cases: Array<[string, number]> = [
            ['BUDGET_EXCEEDED', 400],
            ['INVALID_BLOCK_LENGTH', 400],
            ['CATEGORY_REQUIRED', 400],
            ['ILLEGAL_BLOCK_STATE', 409],
            ['ALREADY_SETTLED', 409],
            ['CALENDAR_SYNC_FAILED', 502],
            ['WEEK_ALREADY_CLOSED', 409],
        ];

        for (const [code, expectedStatus] of cases) {
            const response = toErrorResponse(new NfsError(code as never, '메시지'));
            expect(response.status, code).toBe(expectedStatus);
        }
    });

    it('⭐ 사용자에게 보여줄 한국어 문구와 detail 을 그대로 전달한다', async () => {
        // 프론트가 코드별 문구를 다시 만들지 않는다는 규약의 핵심.
        // 예산 초과 시 화면은 detail.occupiedBy 로 "무엇이 자리를 차지하는지"를 보여준다.
        const response = toErrorResponse(
            budgetExceeded(240, 300, { occupiedBy: [{ title: '파트너사 미팅' }] }),
        );
        const body = await bodyOf(response);

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
            success: false,
            error: {
                code: 'BUDGET_EXCEEDED',
                message: '오늘 남은 4시간을 넘습니다',
                detail: { remainingMinutes: 240, occupiedBy: [{ title: '파트너사 미팅' }] },
            },
        });
    });

    it('Zod 검증 실패는 400 + 어느 필드가 틀렸는지', async () => {
        const schema = z.object({ plannedMinutes: z.number().int().min(30) });

        let caught: unknown = null;
        try {
            schema.parse({ plannedMinutes: 7 });
        } catch (error) {
            caught = error;
        }

        const response = toErrorResponse(caught);
        const body = await bodyOf(response);

        expect(response.status).toBe(400);
        expect(body).toMatchObject({ success: false, error: { code: 'INVALID_REQUEST' } });
        expect(body).toHaveProperty('error.detail.fields.plannedMinutes');
    });

    it('⭐ 예상 못 한 예외는 내부 메시지를 밖으로 내보내지 않는다', async () => {
        const response = toErrorResponse(
            new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
        );
        const body = await bodyOf(response);

        expect(response.status).toBe(500);
        expect(JSON.stringify(body)).not.toContain('hunter2');
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
        expect(body).toMatchObject({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: '잠시 후 다시 시도해주세요' },
        });
    });
});
