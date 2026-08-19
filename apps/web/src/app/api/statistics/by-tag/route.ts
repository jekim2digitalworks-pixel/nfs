import { z } from 'zod';
import { StatisticsPeriodSchema } from '@nfs/domain';
import { withMember } from '@/server/http/withMember';
import { loadTagBreakdown } from '@/server/services/statistics';
import { nowInAppZone, workDateOf } from '@nfs/domain/time';

const QuerySchema = z.object({
    period: StatisticsPeriodSchema.default('MONTH'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request): Promise<Response> {
    return withMember(async function loadByTag(memberId) {
        const url = new URL(request.url);
        const query = QuerySchema.parse({
            period: url.searchParams.get('period') ?? undefined,
            date: url.searchParams.get('date') ?? undefined,
        });

        const anchorDate = query.date ?? workDateOf(nowInAppZone());
        return await loadTagBreakdown(memberId, query.period, anchorDate);
    });
}
