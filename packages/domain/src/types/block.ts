import { z } from 'zod';

/**
 * 진행 중인 블록의 상태. (가변 작업 영역 — ActiveBlock)
 *
 * 완료된 블록은 여기에 없다. 정산되어 TimeLog(불변 원장)로 넘어가고
 * ActiveBlock 행 자체가 사라지기 때문이다. (docs/개발/02-데이터모델.md §1)
 */
export const BLOCK_STATUSES = ['READY', 'RUNNING', 'PAUSED'] as const;
export const BlockStatusSchema = z.enum(BLOCK_STATUSES);
export type BlockStatus = z.infer<typeof BlockStatusSchema>;

/**
 * 블록이 어떻게 끝났는가. TimeLog에 스냅샷으로 남는다.
 *
 * 이 값을 남기는 이유는 통계가 아니라 회고를 위해서다.
 * "계획한 3시간 중 조기 종료가 몇 번이었나"가 사용자에게 의미 있는 신호다.
 */
export const COMPLETION_TYPES = [
    'NORMAL_COMPLETED',
    'EARLY_FINISHED',
    /// 자정 배치가 강제 정산 — **신뢰도 낮은 데이터로 구분한다**
    'AUTO_SETTLED',
    'ABANDONED',
    /// 주간 마감 시 구글 캘린더에서 이관된 행
    'CALENDAR_IMPORTED',
] as const;
export const CompletionTypeSchema = z.enum(COMPLETION_TYPES);
export type CompletionType = z.infer<typeof CompletionTypeSchema>;

/**
 * 원장 한 줄이 어디서 왔는가.
 *
 * 집중 시간(실측)과 일정 시간(신고)은 끝까지 합산하지 않는다.
 * 통계는 이 컬럼으로 GROUP BY 해서 두 값을 나란히 보여준다.
 */
export const SOURCE_TYPES = ['NFS_BLOCK', 'GOOGLE_CALENDAR'] as const;
export const SourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/** 블록 길이 규칙 — 30분 배수, 30~180분. (docs/기획/03-서비스정책.md §1) */
export const BLOCK_MINUTES_UNIT = 30;
export const BLOCK_MINUTES_MIN = 30;
export const BLOCK_MINUTES_MAX = 180;
