/**
 * 하단 탭 아이콘. 인라인 SVG 로 둔다 —
 * 아이콘 3개 때문에 아이콘 라이브러리를 넣지 않는다.
 */
export function ReportIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 13V7M6 13V3M10 13V9M14 13V5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
    );
}

export function DayIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.8" y="2.8" width="12.4" height="11.4" rx="3" stroke="currentColor" strokeWidth="1.6" />
            <path d="M1.8 6.4h12.4M5.3 1.5v2.6M10.7 1.5v2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

export function FocusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8.8" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 5.8v3l1.9 1.1M6 1.4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}
