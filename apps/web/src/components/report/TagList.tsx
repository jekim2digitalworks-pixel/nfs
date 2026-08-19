import { CATEGORY_TAG_LABELS, type CategoryTag } from '@nfs/domain';
import { formatHourMinute } from '@/lib/format';

/**
 * 태그별 목록 — 링 아래에 붙는다.
 *
 * 한 행에 **세 가지 정보**를 담는다:
 *   집중/일정 분리 · 전체 대비 비중(막대) · 합계
 * 시안 A 의 구조를 그대로 옮겼다.
 */

export interface TagRow {
    categoryTag: CategoryTag;
    focusMinutes: number;
    calendarMinutes: number;
    combinedMinutes: number;
    sharePercent: number;
}

interface TagListProps {
    tags: readonly TagRow[];
}

export function TagList({ tags }: TagListProps) {
    if (tags.length === 0) {
        return null;
    }

    // 막대는 1등 대비 상대 길이다. 전체 대비로 그리면 태그가 많을 때 전부 뭉개져 보인다
    const topMinutes = tags[0]?.combinedMinutes ?? 0;

    return (
        <ul className="list" aria-label="카테고리별 시간">
            {tags.map(function renderRow(tag) {
                const barPercent = topMinutes > 0 ? Math.round((tag.combinedMinutes / topMinutes) * 100) : 0;

                return (
                    // data-tag 하나로 색이 정해진다 (tokens.css). 태그별 클래스를 나열하지 않는다
                    <li className="row" key={tag.categoryTag} data-tag={tag.categoryTag}>
                        <span className="dot" aria-hidden="true" />

                        <div>
                            <div className="row-name">{CATEGORY_TAG_LABELS[tag.categoryTag]}</div>
                            <div className="row-sub num">
                                집중 {formatHourMinute(tag.focusMinutes)} · 일정{' '}
                                {formatHourMinute(tag.calendarMinutes)}
                            </div>
                            <div className="track" aria-hidden="true">
                                <i style={{ width: `${barPercent}%` }} />
                            </div>
                        </div>

                        <div className="row-val">
                            <b className="num">{formatHourMinute(tag.combinedMinutes)}</b>
                            <s className="num">{tag.sharePercent}%</s>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
