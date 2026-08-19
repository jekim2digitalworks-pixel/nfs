import { z } from 'zod';
import { withMember } from '@/server/http/withMember';
import { loadMonthlyTrend } from '@/server/services/statistics';
import { nowInAppZone } from '@nfs/domain/time';

const QuerySchema = z.object({
    // 2000 미만·2200 초과는 오타다. 그 범위를 스캔하게 두지 않는다
    year: z.coerce.number().int().min(2000).max(2200).optional(),
});

export async function GET(request: Request): Promise<Response> {
    return withMember(async function loadMonthly(memberId) {
        const url = new URL(request.url);
        const query = QuerySchema.parse({ year: url.searchParams.get('year') ?? undefined });

        const year = query.year ?? nowInAppZone().year;
        return { year: year, points: await loadMonthlyTrend(memberId, year) };
    });
}
