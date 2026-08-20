import Link from 'next/link';
import { CATEGORY_TAG_LABELS, type CategoryTag } from '@nfs/domain';

/**
 * 하루 타임라인 (시안 B)
 *
 * ⭐ **좌표는 이 파일의 헬퍼 하나만 쓴다.**
 *    시안 작업 중 `10:00–11:30`(90분)을 150분으로 계산해
 *    블록이 2.5시간짜리로 그려진 사고가 있었다 (퍼블 §4.3).
 *
 * 왼쪽은 내가 한 것(블록), 오른쪽은 캘린더가 주장하는 것(일정).
 * 같은 쪽에 두면 블록에 가려 일정 제목이 안 보인다.
 */

const HOUR_HEIGHT_PX = 46;

/** 분 → 픽셀. 이 앱에서 시간을 길이로 바꾸는 유일한 함수다 */
function minutesToPixels(minutes: number): number {
    return minutes * (HOUR_HEIGHT_PX / 60);
}

export interface TimelineBlock {
    activeBlockId: string;
    title: string;
    categoryTag: CategoryTag;
    /** 그날 0시 기준 분 */
    startMinute: number;
    lengthMinutes: number;
    isLive: boolean;
    /** 진행률(0~100). RUNNING 일 때만 의미 있다 */
    progressPercent: number;
}

export interface TimelineEvent {
    key: string;
    title: string;
    startMinute: number;
    lengthMinutes: number;
}

/**
 * 오늘이 통째로 빈 날의 제안 (U-07 · 시안 G · N-037)
 *
 * ⭐ **카드가 아니라 격자 위의 구간이다.** 화면 한가운데 카드로 띄우면
 *    "3시간"이 그냥 글자지만, 격자에 얹으면 **어디서 어디까지인지 형태로 보인다.**
 */
export interface TimelineProposal {
    /** 그날 0시 기준 분 */
    startMinute: number;
    lengthMinutes: number;
    /** 줄 단위로 받는다 — 어디서 줄이 바뀌는지가 시안의 일부다 */
    labelLines: readonly string[];
    actionLabel: string;
    href: string;
}

interface TimelineProps {
    /** 표시 구간의 시작 시(0~23). 보통 "지금부터 3시간" 근처를 보여준다 */
    fromHour: number;
    /** 표시할 시간 수 */
    hourCount: number;
    blocks: readonly TimelineBlock[];
    events: readonly TimelineEvent[];
    /** 지금 시각(그날 0시 기준 분). 구간 밖이면 선을 그리지 않는다 */
    nowMinute: number;
    nowLabel: string;
    /** 블록도 일정도 없을 때만 넘긴다 */
    proposal?: TimelineProposal;
}

export function Timeline({
    fromHour,
    hourCount,
    blocks,
    events,
    nowMinute,
    nowLabel,
    proposal,
}: TimelineProps) {
    const fromMinute = fromHour * 60;
    const toMinute = fromMinute + hourCount * 60;
    const laneHeight = minutesToPixels(hourCount * 60);

    /** 구간 기준 상대 좌표로 바꾼다. 구간 밖이면 null */
    function positionOf(startMinute: number, lengthMinutes: number) {
        const endMinute = startMinute + lengthMinutes;

        if (endMinute <= fromMinute || startMinute >= toMinute) {
            return null;
        }

        // 구간 경계에서 잘라낸다. 안 자르면 레인 밖으로 삐져나간다
        const clippedStart = Math.max(startMinute, fromMinute);
        const clippedEnd = Math.min(endMinute, toMinute);

        return {
            top: minutesToPixels(clippedStart - fromMinute),
            height: minutesToPixels(clippedEnd - clippedStart),
        };
    }

    const hourLines: number[] = [];
    for (let index = 0; index <= hourCount; index = index + 1) {
        hourLines.push(fromHour + index);
    }

    const showNowLine = nowMinute >= fromMinute && nowMinute <= toMinute;

    // 제안 구간도 블록과 **같은 좌표 함수**를 쓴다. 여기서 따로 계산하면
    // 구간 경계에서 잘리는 규칙이 갈려 제안만 레인 밖으로 삐져나간다
    let proposalPosition: { top: number; height: number } | null = null;
    let proposalLines: readonly string[] = [];
    let proposalActionLabel = '';
    let proposalHref = '/day?new=1';

    if (proposal !== undefined) {
        proposalPosition = positionOf(proposal.startMinute, proposal.lengthMinutes);
        proposalLines = proposal.labelLines;
        proposalActionLabel = proposal.actionLabel;
        proposalHref = proposal.href;
    }

    return (
        <div className="tl" style={{ height: laneHeight }}>
            {hourLines.map(function renderHourLine(hour) {
                return (
                    <div
                        key={hour}
                        className="gl"
                        style={{ top: minutesToPixels((hour - fromHour) * 60) }}
                    >
                        <b className="num">{String(hour).padStart(2, '0')}:00</b>
                    </div>
                );
            })}

            <div className="lane">
                {events.map(function renderEvent(event) {
                    const position = positionOf(event.startMinute, event.lengthMinutes);
                    if (position === null) {
                        return null;
                    }
                    return (
                        <div
                            key={event.key}
                            className="evt"
                            style={{ top: position.top, height: position.height }}
                        >
                            <div className="evt-t">{event.title}</div>
                        </div>
                    );
                })}

                {blocks.map(function renderBlock(block) {
                    const position = positionOf(block.startMinute, block.lengthMinutes);
                    if (position === null) {
                        return null;
                    }

                    // 제목이 비어 있으면 태그명이 제목이 된다 (정책 §1.1).
                    // 서버가 한국어를 원장에 박지 않으므로 화면이 채운다
                    const title =
                        block.title.length > 0 ? block.title : CATEGORY_TAG_LABELS[block.categoryTag];

                    return (
                        <div
                            key={block.activeBlockId}
                            className={block.isLive ? 'blk live' : 'blk'}
                            data-tag={block.categoryTag}
                            style={{ top: position.top, height: position.height }}
                        >
                            <div className="blk-t">{title}</div>
                            <div className="blk-m num">
                                {CATEGORY_TAG_LABELS[block.categoryTag]} · {block.lengthMinutes}분
                            </div>

                            {block.isLive ? <span className="live-dot" aria-hidden="true" /> : null}
                            {block.isLive ? (
                                <span
                                    className="prog"
                                    style={{ width: `${block.progressPercent}%` }}
                                    aria-hidden="true"
                                />
                            ) : null}
                        </div>
                    );
                })}

                {proposalPosition === null ? null : (
                    <div
                        className="propose"
                        style={{ top: proposalPosition.top, height: proposalPosition.height }}
                    >
                        <p>
                            {proposalLines.map(function renderLine(line, index) {
                                const isLast = index === proposalLines.length - 1;
                                return (
                                    <span key={line}>
                                        {line}
                                        {isLast ? null : <br />}
                                    </span>
                                );
                            })}
                        </p>
                        <Link className="btn btn--primary btn--inline" href={proposalHref}>
                            {proposalActionLabel}
                        </Link>
                    </div>
                )}

                {showNowLine ? (
                    <div
                        className="nowline"
                        style={{ top: minutesToPixels(nowMinute - fromMinute) }}
                        aria-hidden="true"
                    >
                        <b className="num">{nowLabel}</b>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
