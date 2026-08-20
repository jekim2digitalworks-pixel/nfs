/**
 * 스켈레톤 조각 (U-07 · 시안 G)
 *
 * ⭐ **이 컴포넌트는 "회색 박스"를 그리는 게 아니라 자리를 잡아두는 것이다.**
 *    폭·높이를 호출부가 직접 주는 이유가 여기 있다 — 기본값을 두면
 *    "적당한 크기"로 그리게 되고, 데이터가 도착하는 순간 레이아웃이 튄다.
 *    폭은 **실제로 올 글자 수만큼**만 잡는다 (100% 폭 바는 도착할 때 확 줄어 더 튄다).
 *
 * ⭐ **서버 컴포넌트다.** 움직임은 전부 CSS 애니메이션이라 자바스크립트가 필요 없다.
 */

type SkeletonShape =
    /** 알약 — 글자 한 줄 자리 */
    | 'pill'
    /** 타임라인 블록·입력칸 자리 (--r-md) */
    | 'block'
    /** 큰 카드 자리 (--r-xl) */
    | 'card';

interface SkeletonProps {
    width: number | string;
    height: number;
    shape?: SkeletonShape;
    /** 가운데 정렬이 필요한 자리(링 중앙 등)에서 쓴다 */
    center?: boolean;
    marginTop?: number;
}

function classNameOf(shape: SkeletonShape): string {
    if (shape === 'block') {
        return 'sk sk--block';
    }
    if (shape === 'card') {
        return 'sk sk--card';
    }
    return 'sk';
}

export function Skeleton({ width, height, shape = 'pill', center = false, marginTop }: SkeletonProps) {
    const style: React.CSSProperties = {
        width: width,
        height: height,
    };

    if (center) {
        style.marginLeft = 'auto';
        style.marginRight = 'auto';
    }
    if (marginTop !== undefined) {
        style.marginTop = marginTop;
    }

    // aria-hidden: 스켈레톤은 읽어줄 내용이 없다.
    // 로딩 사실은 화면 루트가 aria-busy 로 한 번만 알린다 — 조각마다 알리면 소음이다
    return <span className={classNameOf(shape)} style={style} aria-hidden="true" />;
}
