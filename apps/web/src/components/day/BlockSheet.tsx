'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    CATEGORY_TAGS,
    CATEGORY_TAG_LABELS,
    previewWithCandidate,
    type BudgetOccupant,
    type CategoryTag,
    type SourceType,
} from '@nfs/domain';
import { parseAppDateTime, toAppLocalString } from '@nfs/domain/time';
import { formatHourMinute, formatKoreanDuration, splitHeroTime } from '@/lib/format';


/**
 * S-05 블록 생성 시트 (U-06 · 시안 E)
 *
 * ⭐⭐ **이 시트의 주 오브젝트는 폼이 아니라 "만들면 얼마가 남는가"다.**
 *     폼을 위에 두면 이 앱은 그냥 일정 등록기가 된다.
 *
 * ⭐ 미리보기는 **서버와 같은 예산 계산기**(`packages/domain`)로 계산한다.
 *   서버에 물어보지 않는 이유는 두 가지다:
 *     1. 칩을 누를 때마다 왕복하면 숫자가 늦게 따라온다 — 미리보기의 의미가 사라진다
 *     2. 계산기를 두 벌로 만들면 화면의 "남은 시간"과 서버의 검증이 갈린다.
 *        같은 코드를 쓰므로 화면이 "만들 수 있다"고 말한 걸 서버가 거절하는 일이 없다
 *   그래도 **최종 판단은 서버**다. 화면을 열어둔 사이 다른 기기에서 블록이 생겼을 수 있다.
 *
 * ⚠️ 시각의 기준은 **서버가 내려준 `nowLocal`** 이다. 사용자의 PC 시계는 믿지 않는다.
 */

/** 서버 → 클라이언트로 넘길 수 있는 모양. Luxon DateTime 은 직렬화되지 않는다 */
export interface SerializedOccupant {
    referenceKey: string;
    sourceType: SourceType;
    categoryTag: CategoryTag;
    title: string;
    /** 'yyyy-MM-ddTHH:mm:ss' (앱 타임존 로컬 시각) */
    startTime: string;
    endTime: string;
}

interface BlockSheetProps {
    /** 집중 화면의 "계속 이어서"·집중 탭이 `?new=1` 로 들어오면 열린 채로 시작한다 */
    defaultOpen?: boolean;
    workDate: string;
    /** 서버 기준 지금 (앱 타임존 로컬 문자열) */
    nowLocal: string;
    occupants: SerializedOccupant[];
}

/** 길이 선택지 (정책 §1.1 — 30분 배수, 30~180분) */
const LENGTH_CHOICES = [30, 60, 90, 120] as const;

/** 시작 시각 칩 개수. 30분 격자로 앞으로 이만큼 제안한다 */
const START_CHOICE_COUNT = 8;

const GRID_UNIT_MINUTES = 30;

/** 예산 초과 화면에 몇 개까지 보여줄 것인가. 다 보여주면 "정리하라"는 말이 묻힌다 */
const OVERLAP_LIST_LIMIT = 4;

/**
 * 사용자가 고를 수 있는 태그.
 *
 * 미분류는 뺀다 — 그건 사용자가 고르는 값이 아니라 **캘린더 이관의 기본값**이다.
 * 고를 수 있게 두면 "태그 필수"라는 정책(§1.1)이 사실상 무력해진다.
 */
const SELECTABLE_TAGS: CategoryTag[] = [];
for (const tag of CATEGORY_TAGS) {
    if (tag !== 'UNCATEGORIZED') {
        SELECTABLE_TAGS.push(tag);
    }
}

function toOccupants(serialized: SerializedOccupant[]): BudgetOccupant[] {
    const occupants: BudgetOccupant[] = [];

    for (const item of serialized) {
        occupants.push({
            referenceKey: item.referenceKey,
            sourceType: item.sourceType,
            categoryTag: item.categoryTag,
            title: item.title,
            startTime: parseAppDateTime(item.startTime),
            endTime: parseAppDateTime(item.endTime),
        });
    }
    return occupants;
}

export function BlockSheet({ workDate, nowLocal, occupants, defaultOpen = false }: BlockSheetProps) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [categoryTag, setCategoryTag] = useState<CategoryTag | null>(null);
    const [title, setTitle] = useState('');
    const [lengthMinutes, setLengthMinutes] = useState<number>(60);
    const [startIndex, setStartIndex] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [serverMessage, setServerMessage] = useState<string | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);

    const now = useMemo(
        function parseNow() {
            return parseAppDateTime(nowLocal);
        },
        [nowLocal],
    );

    /**
     * 시작 시각 후보 — 30분 격자 (정책 §1.1).
     *
     * 첫 칸이 "지금"이다. 정확히는 **다음 격자**다.
     * 14:07 에 14:07 시작을 허용하면 타임라인이 어긋나 보이고
     * 사용자가 "왜 7분이 비었지"를 계속 묻게 된다.
     */
    const startChoices = useMemo(
        function buildStartChoices() {
            const minuteOfHour = now.minute;
            let firstGrid = now.startOf('hour');

            if (minuteOfHour >= GRID_UNIT_MINUTES) {
                firstGrid = firstGrid.plus({ hours: 1 });
            } else {
                firstGrid = firstGrid.plus({ minutes: GRID_UNIT_MINUTES });
            }

            const choices = [];
            for (let index = 0; index < START_CHOICE_COUNT; index = index + 1) {
                choices.push(firstGrid.plus({ minutes: GRID_UNIT_MINUTES * index }));
            }
            return choices;
        },
        [now],
    );

    let startTime = startChoices[0];
    if (startChoices[startIndex] !== undefined) {
        startTime = startChoices[startIndex];
    }

    /**
     * 미리보기 — 서버의 `createBlock` 과 **같은 순서로** 계산한다.
     * (도메인 `assertBlockFitsInBudget` 의 판정을 그대로 옮긴 것이다)
     */
    const preview = useMemo(
        function calculatePreview() {
            const baseInput = { workDate: workDate, occupants: toOccupants(occupants) };

            let selectedTag: CategoryTag = 'UNCATEGORIZED';
            if (categoryTag !== null) {
                selectedTag = categoryTag;
            }

            const candidate: BudgetOccupant = {
                referenceKey: 'new',
                sourceType: 'NFS_BLOCK',
                categoryTag: selectedTag,
                title: title,
                startTime: startTime,
                endTime: startTime.plus({ minutes: lengthMinutes }),
            };

            return previewWithCandidate(baseInput, candidate);
        },
        [workDate, occupants, startTime, lengthMinutes, categoryTag, title],
    );

    const canSubmit = categoryTag !== null && !preview.isExceeded && !isSubmitting;

    // 시트를 열면 닫기 버튼에 포커스를 준다. 키보드 사용자가 시트 밖에 갇히지 않게
    useEffect(
        function focusOnOpen() {
            if (isOpen && closeButtonRef.current !== null) {
                closeButtonRef.current.focus();
            }
        },
        [isOpen],
    );

    useEffect(
        function closeOnEscape() {
            if (!isOpen) {
                return;
            }
            function handleKeyDown(event: KeyboardEvent) {
                if (event.key === 'Escape') {
                    setIsOpen(false);
                }
            }
            window.addEventListener('keydown', handleKeyDown);

            return function cleanup() {
                window.removeEventListener('keydown', handleKeyDown);
            };
        },
        [isOpen],
    );

    async function submit(startImmediately: boolean) {
        if (categoryTag === null || startTime === undefined) {
            return;
        }
        setIsSubmitting(true);
        setServerMessage(null);

        try {
            const response = await fetch('/api/blocks', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    categoryTag: categoryTag,
                    title: title,
                    plannedStartTime: toAppLocalString(startTime),
                    plannedMinutes: lengthMinutes,
                    startImmediately: startImmediately,
                }),
            });

            const payload = await response.json();

            if (!response.ok || payload.success !== true) {
                // 서버 메시지는 사용자에게 그대로 보여줄 한국어다 (아키텍처 §8).
                // 봉투가 깨진 경우까지 대비해 한 단계씩 확인한다
                let message = '블록을 만들지 못했습니다';

                if (payload !== null && typeof payload === 'object' && 'error' in payload) {
                    const error = payload.error;

                    if (error !== null && typeof error === 'object' && 'message' in error) {
                        if (typeof error.message === 'string') {
                            message = error.message;
                        }
                    }
                }
                setServerMessage(message);
                return;
            }

            setIsOpen(false);
            setTitle('');

            if (startImmediately) {
                // 방금 만든 블록의 집중 화면(S-04)으로 바로 넘어간다
                router.push(`/focus/${payload.data.activeBlockId}`);
                return;
            }
            // 서버 컴포넌트를 다시 그려 예산·타임라인을 갱신한다
            router.refresh();
        } catch {
            setServerMessage('네트워크가 불안정합니다. 다시 시도해 주세요');
        } finally {
            setIsSubmitting(false);
        }
    }

    const remaining = splitHeroTime(Math.abs(preview.remainingAfterMinutes));

    let selectedTagLabel = '';
    if (categoryTag !== null) {
        selectedTagLabel = CATEGORY_TAG_LABELS[categoryTag];
    }

    /**
     * 하단 안내 한 줄. **한 번에 하나만 말한다** (정책 §1.1 의 검증 순서와 같은 이유).
     * "태그도 없고 예산도 넘었다"는 무엇부터 고쳐야 할지 알려주지 않는다.
     */
    function hintMessage(): string {
        if (categoryTag === null) {
            return '카테고리를 골라주세요';
        }
        if (preview.isExceeded) {
            return '길이를 줄이거나 겹치는 일정을 정리하면 만들 수 있습니다';
        }
        return '지금 시작하면 집중 화면으로 넘어갑니다';
    }

    /**
     * 미터는 그림이라 스크린리더에 값이 닿지 않는다. 문장으로 옮긴다 (디자인 §8).
     * 색·길이로만 전달되는 정보를 남기지 않는다.
     */
    function meterLabel(): string {
        const used = formatKoreanDuration(preview.before.occupiedMinutes);
        const requested = formatKoreanDuration(preview.requestedMinutes);

        if (preview.isExceeded) {
            return `지금 ${used} 사용. 이 블록 ${requested}을 더하면 오늘 남은 시간을 넘습니다`;
        }
        return `지금 ${used} 사용. 이 블록 ${requested}을 더하면 ${formatKoreanDuration(preview.remainingAfterMinutes)} 남습니다`;
    }

    /** 예산을 이미 먹고 있는 것들. 초과했을 때 "무엇이 자리를 차지했나"를 보여준다 */
    const topOccupants = [];
    for (const attribution of preview.before.occupants) {
        if (topOccupants.length >= OVERLAP_LIST_LIMIT) {
            break;
        }
        if (attribution.attributedMinutes > 0) {
            topOccupants.push(attribution);
        }
    }

    return (
        <>
            <button className="fab" type="button" onClick={() => setIsOpen(true)}>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                    <path d="M7.5 1v13M1 7.5h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                블록
            </button>

            {isOpen ? (
                <div className="sheet-layer">
                    {/* 스크림을 눌러도 닫힌다. 시트 밖은 전부 '취소'다 */}
                    <button className="sheet-scrim" type="button" aria-label="닫기" onClick={() => setIsOpen(false)} />

                    <section
                        className="sheet-block"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="sheet-title"
                        data-tag={categoryTag === null ? 'UNCATEGORIZED' : categoryTag}
                    >
                        <div className="sheet-grab" aria-hidden="true" />

                        <header className="sheet-head">
                            <h2 id="sheet-title">블록 만들기</h2>
                            <button
                                className="icon-btn"
                                type="button"
                                aria-label="닫기"
                                ref={closeButtonRef}
                                onClick={() => setIsOpen(false)}
                            >
                                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                                    <path
                                        d="M1 1l11 11M12 1L1 12"
                                        stroke="currentColor"
                                        strokeWidth="1.7"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </button>
                        </header>

                        <div className="sheet-body">
                            {/* 초과일 때만 나온다 — 걸리지 않는 제약은 설명하지 않는다 (N-010) */}
                            {preview.isExceeded ? (
                                <section className="over">
                                    <p className="over-t">
                                        오늘 남은{' '}
                                        <span className="num">
                                            {formatKoreanDuration(preview.before.remainingMinutes)}
                                        </span>
                                        을 넘습니다
                                    </p>
                                    <ul className="over-l">
                                        {topOccupants.map(function renderOccupant(occupant) {
                                            let label = CATEGORY_TAG_LABELS[occupant.categoryTag];
                                            if (occupant.title.length > 0) {
                                                label = occupant.title;
                                            }

                                            return (
                                                <li key={occupant.referenceKey} data-tag={occupant.categoryTag}>
                                                    <b>
                                                        <span className="tag-dot" />
                                                        {label}
                                                    </b>
                                                    <span className="num">
                                                        {formatHourMinute(occupant.attributedMinutes)}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </section>
                            ) : null}

                            <section className={preview.isExceeded ? 'pre pre--over' : 'pre'}>
                                <p className="pre-cap">이 블록을 만들면 오늘 남은 시간</p>
                                <p className="pre-num num">
                                    {preview.remainingAfterMinutes < 0 ? '−' : ''}
                                    {remaining.hours}
                                    <i>시간</i>
                                    {remaining.minutes}
                                    <i>분</i>
                                    <span className="delta num">−{formatKoreanDuration(preview.requestedMinutes)}</span>
                                </p>

                                <div className="meter" role="img" aria-label={meterLabel()}>
                                    {preview.before.calendarMinutes > 0 ? (
                                        <i className="m-cal" style={{ flexGrow: preview.before.calendarMinutes }} />
                                    ) : null}
                                    {preview.before.blockMinutes > 0 ? (
                                        <i className="m-nfs" style={{ flexGrow: preview.before.blockMinutes }} />
                                    ) : null}
                                    {preview.requestedMinutes > 0 ? (
                                        <i className="m-new" style={{ flexGrow: preview.requestedMinutes }} />
                                    ) : null}
                                    {preview.remainingAfterMinutes > 0 ? (
                                        <i className="m-free" style={{ flexGrow: preview.remainingAfterMinutes }} />
                                    ) : null}
                                </div>

                                <div className="keys">
                                    <span>
                                        <b className="key-new" />새 블록{' '}
                                        <span className="num">{formatHourMinute(preview.requestedMinutes)}</span>
                                    </span>
                                    <span>
                                        <b className="key-used" />
                                        지금까지{' '}
                                        <span className="num">
                                            {formatHourMinute(preview.before.occupiedMinutes)}
                                        </span>
                                    </span>
                                </div>
                            </section>

                            <div className="field">
                                <p className="field-label" id="label-category">
                                    카테고리
                                </p>
                                <div className="chips" role="radiogroup" aria-labelledby="label-category">
                                    {SELECTABLE_TAGS.map(function renderTagChip(tag) {
                                        const isSelected = tag === categoryTag;

                                        return (
                                            <button
                                                key={tag}
                                                type="button"
                                                role="radio"
                                                aria-checked={isSelected}
                                                data-tag={tag}
                                                className={isSelected ? 'chip chip--on' : 'chip'}
                                                onClick={() => setCategoryTag(tag)}
                                            >
                                                <span className="tag-dot" />
                                                {CATEGORY_TAG_LABELS[tag]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="field">
                                <label className="field-label" htmlFor="block-title">
                                    제목
                                </label>
                                <input
                                    id="block-title"
                                    className="input"
                                    type="text"
                                    maxLength={100}
                                    value={title}
                                    placeholder={selectedTagLabel.length > 0 ? selectedTagLabel : '비우면 태그 이름'}
                                    onChange={(event) => setTitle(event.target.value)}
                                />
                            </div>

                            <div className="field">
                                <p className="field-label" id="label-start">
                                    시작
                                </p>
                                <div className="rail" role="radiogroup" aria-labelledby="label-start">
                                    {startChoices.map(function renderStartChip(choice, index) {
                                        const isSelected = index === startIndex;
                                        let className = 'chip';

                                        if (index === 0) {
                                            className = className + ' chip--now';
                                        }
                                        if (isSelected) {
                                            className = className + ' chip--on';
                                        }

                                        return (
                                            <button
                                                key={choice.toISO()}
                                                type="button"
                                                role="radio"
                                                aria-checked={isSelected}
                                                className={className}
                                                onClick={() => setStartIndex(index)}
                                            >
                                                <span className="num">
                                                    {index === 0 ? '바로 ' : ''}
                                                    {choice.toFormat('HH:mm')}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="field">
                                <p className="field-label" id="label-length">
                                    길이
                                </p>
                                <div className="lens" role="radiogroup" aria-labelledby="label-length">
                                    {LENGTH_CHOICES.map(function renderLengthChip(choice) {
                                        const isSelected = choice === lengthMinutes;

                                        return (
                                            <button
                                                key={choice}
                                                type="button"
                                                role="radio"
                                                aria-checked={isSelected}
                                                className={isSelected ? 'chip chip--on' : 'chip'}
                                                onClick={() => setLengthMinutes(choice)}
                                            >
                                                <span className="num">{choice}분</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <footer className="sheet-acts">
                            {serverMessage !== null ? (
                                <p className="sheet-error" role="alert">
                                    {serverMessage}
                                </p>
                            ) : null}

                            <button
                                className="btn btn--primary"
                                type="button"
                                disabled={!canSubmit}
                                onClick={() => submit(true)}
                            >
                                <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true">
                                    <path d="M4 2.4v10.2c0 .5.5.8 1 .6l8.2-5.1a.7.7 0 0 0 0-1.2L5 1.8a.7.7 0 0 0-1 .6Z" />
                                </svg>
                                지금 시작하기
                            </button>
                            <button
                                className="btn btn--secondary"
                                type="button"
                                disabled={!canSubmit}
                                onClick={() => submit(false)}
                            >
                                나중에 시작
                            </button>

                            <p className="sheet-hint">{hintMessage()}</p>
                        </footer>
                    </section>
                </div>
            ) : null}
        </>
    );
}
