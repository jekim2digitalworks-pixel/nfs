import { z } from 'zod';
import { CategoryTagSchema, BLOCK_MINUTES_MAX, BLOCK_MINUTES_MIN } from '@nfs/domain';
import { nowInAppZone, parseAppDateTime } from '@nfs/domain/time';
import { withMember } from '@/server/http/withMember';
import { createBlock } from '@/server/services/block';

const CreateBlockSchema = z.object({
    categoryTag: CategoryTagSchema,
    title: z.string().max(100).default(''),
    // 존 표기 없는 로컬 시각. 단일 타임존 전제라 존을 실어 보내면 해석이 갈린다
    plannedStartTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
    plannedMinutes: z.number().int().min(BLOCK_MINUTES_MIN).max(BLOCK_MINUTES_MAX),
    startImmediately: z.boolean().default(false),
});

export async function POST(request: Request): Promise<Response> {
    return withMember(async function create(memberId) {
        const command = CreateBlockSchema.parse(await request.json());

        return await createBlock(
            memberId,
            {
                categoryTag: command.categoryTag,
                title: command.title,
                plannedStartTime: parseAppDateTime(command.plannedStartTime),
                plannedMinutes: command.plannedMinutes,
                startImmediately: command.startImmediately,
            },
            nowInAppZone(),
        );
    }, { status: 201 });
}
