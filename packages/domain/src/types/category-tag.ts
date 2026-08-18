import { z } from 'zod';

/**
 * 카테고리 태그 — 고정 7종 + 미분류. (docs/기획/03-서비스정책.md §5)
 *
 * 사용자 정의 태그를 열지 않는 이유:
 *   통계의 축이 가변이 되면 집계 쿼리와 화면 DTO가 함께 무너진다.
 *   링 차트의 색도 태그당 하나씩 고정돼 있다 (디자인 토큰 --dev, --meet …).
 */
export const CATEGORY_TAGS = [
    'DEVELOPMENT',
    'MEETING',
    'STUDY',
    'FAMILY',
    'HEALTH',
    'PERSONAL',
    'CHORE',
    'UNCATEGORIZED',
] as const;

export const CategoryTagSchema = z.enum(CATEGORY_TAGS);
export type CategoryTag = z.infer<typeof CategoryTagSchema>;

/** 화면에 그대로 쓸 한국어 표시명. 서버가 내려주지 않고 프론트가 이 표를 쓴다. */
export const CATEGORY_TAG_LABELS: Record<CategoryTag, string> = {
    DEVELOPMENT: '개발',
    MEETING: '회의',
    STUDY: '학습',
    FAMILY: '가족',
    HEALTH: '건강',
    PERSONAL: '개인',
    CHORE: '잡무',
    UNCATEGORIZED: '미분류',
};

/** 디자인 토큰 이름. 색 값은 CSS가 소유한다 — 여기서 hex를 정의하지 않는다. */
export const CATEGORY_TAG_COLOR_TOKENS: Record<CategoryTag, string> = {
    DEVELOPMENT: '--dev',
    MEETING: '--meet',
    STUDY: '--study',
    FAMILY: '--family',
    HEALTH: '--health',
    PERSONAL: '--self',
    CHORE: '--chore',
    UNCATEGORIZED: '--tx3',
};
