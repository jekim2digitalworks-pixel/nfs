import { describe, expect, it } from 'vitest';
import {
    CATEGORY_TAGS,
    BLOCK_STATUSES,
    SOURCE_TYPES,
    COMPLETION_TYPES,
} from '@nfs/domain/types';
import {
    CategoryTag as DbCategoryTag,
    BlockStatus as DbBlockStatus,
    SourceType as DbSourceType,
    CompletionType as DbCompletionType,
} from '@nfs/db';

/**
 * 도메인 enum과 DB enum이 어긋나지 않는지 지킨다.
 *
 * 왜 필요한가:
 *   같은 값 목록이 packages/domain/types 와 prisma/schema.prisma 두 곳에 산다.
 *   Postgres 네이티브 enum 이라 DB 에 없는 값을 넣으면 INSERT 가 터지는데,
 *   그게 **운영에서 처음 터진다.** 태그를 하나 추가하고 스키마를 안 고치는 실수가
 *   가장 흔하고, 마이그레이션이 필요해서 잊기도 쉽다.
 *
 * 이 테스트는 그 실수를 CI 에서 잡는다.
 *
 * 왜 이 파일이 apps/web 에 있나:
 *   packages/domain 은 @nfs/db 를 import 할 수 없다 (순수 함수 철칙 · eslint 가 막는다).
 *   두 쪽을 다 볼 수 있는 곳은 앱 뿐이다.
 */

function sortedValues(source: Record<string, string> | readonly string[]): string[] {
    const values = Array.isArray(source) ? [...source] : Object.values(source);
    return values.sort();
}

describe('도메인 enum ↔ DB enum 정합성', () => {
    it('CategoryTag 가 양쪽에서 같다', () => {
        expect(sortedValues(DbCategoryTag)).toEqual(sortedValues(CATEGORY_TAGS));
    });

    it('BlockStatus 가 양쪽에서 같다', () => {
        expect(sortedValues(DbBlockStatus)).toEqual(sortedValues(BLOCK_STATUSES));
    });

    it('SourceType 이 양쪽에서 같다', () => {
        expect(sortedValues(DbSourceType)).toEqual(sortedValues(SOURCE_TYPES));
    });

    it('CompletionType 이 양쪽에서 같다', () => {
        expect(sortedValues(DbCompletionType)).toEqual(sortedValues(COMPLETION_TYPES));
    });
});
