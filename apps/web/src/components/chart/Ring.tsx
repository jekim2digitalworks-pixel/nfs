import { CATEGORY_TAG_COLOR_TOKENS, type CategoryTag } from '@nfs/domain';

/**
 * 링 차트 — 태그별 비중 (디자인 §6)
 *
 * 라이브러리를 쓰지 않는다. 필요한 건 `stroke-dasharray` 누적 하나뿐이고,
 * 차트 라이브러리는 클라이언트 컴포넌트를 강제해 이 화면 전체를 클라이언트로 끌어내린다.
 *
 * ⭐ **서버 컴포넌트다.** 값이 정해져 있으므로 브라우저에서 계산할 이유가 없다.
 */

const RADIUS = 76;
const STROKE_WIDTH = 13;
/** 세그먼트 사이 간격. 붙어 있으면 색 경계가 뭉개진다 */
const GAP_LENGTH = 6;

export interface RingSegment {
    categoryTag: CategoryTag;
    minutes: number;
}

interface RingProps {
    segments: readonly RingSegment[];
    /** 링 중앙 — 총계가 아니라 **답**을 놓는다 (N-018) */
    caption: string;
    value: string;
    subValue: string;
    /**
     * 값이 "아직 없음" 처럼 **데이터가 아닌 말**일 때 켠다 (빈 상태 · 시안 G).
     * 30px 흰 글씨로 두면 없는 값이 있는 값처럼 읽힌다.
     */
    valueMuted?: boolean;
}

interface ComputedArc {
    categoryTag: CategoryTag;
    dashLength: number;
    dashOffset: number;
}

/**
 * 각 세그먼트의 호 길이와 시작 위치를 구한다.
 *
 * 원둘레를 비중대로 나누되 각 호에서 간격만큼 뺀다.
 * 간격을 빼지 않고 그리면 마지막 호가 첫 호를 덮어 원이 닫히지 않는다.
 */
function computeArcs(segments: readonly RingSegment[], circumference: number): ComputedArc[] {
    let totalMinutes = 0;
    for (const segment of segments) {
        totalMinutes = totalMinutes + segment.minutes;
    }

    if (totalMinutes <= 0) {
        return [];
    }

    const arcs: ComputedArc[] = [];
    let consumedLength = 0;

    for (const segment of segments) {
        const fullLength = (segment.minutes / totalMinutes) * circumference;

        // 간격보다 짧은 세그먼트는 그리지 않는다. 그리면 음수 길이가 되어 호가 뒤집힌다
        if (fullLength <= GAP_LENGTH) {
            consumedLength = consumedLength + fullLength;
            continue;
        }

        arcs.push({
            categoryTag: segment.categoryTag,
            dashLength: fullLength - GAP_LENGTH,
            dashOffset: -consumedLength,
        });
        consumedLength = consumedLength + fullLength;
    }

    return arcs;
}

export function Ring({ segments, caption, value, subValue, valueMuted = false }: RingProps) {
    const circumference = 2 * Math.PI * RADIUS;
    const arcs = computeArcs(segments, circumference);

    return (
        <div className="ring-wrap">
            <svg viewBox="0 0 200 200" aria-hidden="true">
                {/* rotate(-90) 로 12시 방향에서 시작한다. 안 하면 3시에서 시작해 어색하다 */}
                <g transform="rotate(-90 100 100)" fill="none" strokeWidth={STROKE_WIDTH} strokeLinecap="butt">
                    <circle cx="100" cy="100" r={RADIUS} stroke="rgba(255,255,255,.055)" />
                    {arcs.map(function renderArc(arc) {
                        return (
                            <circle
                                key={arc.categoryTag}
                                className="seg-arc"
                                cx="100"
                                cy="100"
                                r={RADIUS}
                                stroke={`var(${CATEGORY_TAG_COLOR_TOKENS[arc.categoryTag]})`}
                                strokeDasharray={`${arc.dashLength} ${circumference}`}
                                strokeDashoffset={arc.dashOffset}
                            />
                        );
                    })}
                </g>
            </svg>

            <div className="ring-mid">
                <b>{caption}</b>
                <s className={valueMuted ? 'num is-muted' : 'num'}>{value}</s>
                <u>{subValue}</u>
            </div>
        </div>
    );
}
