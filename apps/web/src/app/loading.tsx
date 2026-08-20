import { Skeleton } from '@/components/state/Skeleton';

/**
 * S-02 리포트 로딩 (U-07 · 시안 G)
 *
 * ⭐ **스켈레톤은 회색 박스가 아니라 이 화면의 실루엣이다.**
 *    링 자리에 링(같은 r=76 · stroke-width=13), 목록 자리에 목록을 둔다.
 *    도착해도 **한 픽셀도 움직이지 않는 것** — 그게 스피너를 금지한 진짜 이유다
 *    (화면정의서 §0.4 "스피너 금지 — 레이아웃이 튄다").
 *
 * ⚠️ 캡션 문구("이번 달에 쓴 시간")는 데이터가 아니다. 서버를 기다릴 이유가 없어 진짜를 그린다.
 *    반대로 기간 라벨은 서버가 정하므로 스켈레톤으로 둔다.
 */

/** 링 규격은 `components/chart/Ring.tsx` 와 같아야 한다. 다르면 도착할 때 링이 커지거나 작아진다 */
const RING_RADIUS = 76;
const RING_STROKE_WIDTH = 13;

function SkeletonRow() {
    return (
        <div className="row">
            <Skeleton width={9} height={9} />
            <div>
                <Skeleton width={54} height={13} />
                <Skeleton width={124} height={10} marginTop={7} />
                <div className="track" />
            </div>
            <div className="row-val">
                <Skeleton width={50} height={13} />
                <Skeleton width={34} height={9} marginTop={7} />
            </div>
        </div>
    );
}

export default function ReportLoading() {
    return (
        <>
            {/* 아직 아무 값도 없는데 화면이 뜨거우면 거짓말이다. 블룸을 절반만 켠다 */}
            <div className="bloom bloom--dim" />
            <div className="bloom-2 bloom--dim" />

            <main className="screen screen-report" aria-busy="true" aria-label="리포트를 불러오는 중">
                <header className="nav">
                    <Skeleton width={104} height={36} />
                    <Skeleton width={36} height={36} />
                </header>

                <section className="hero">
                    <p className="hero-cap">이번 기간에 쓴 시간</p>
                    {/* 폭은 "187시간30분" 만큼만. 100% 폭 바를 깔면 도착할 때 확 줄어 더 튄다 */}
                    <Skeleton width={236} height={44} shape="block" marginTop={6} />
                    <Skeleton width={96} height={29} marginTop={14} />
                </section>

                <div className="seg" aria-hidden="true">
                    <Skeleton width="100%" height={34} />
                </div>

                <div className="ring-wrap">
                    <svg viewBox="0 0 200 200" aria-hidden="true">
                        <circle
                            className="sk-ring"
                            cx="100"
                            cy="100"
                            r={RING_RADIUS}
                            fill="none"
                            stroke="rgba(255,255,255,.06)"
                            strokeWidth={RING_STROKE_WIDTH}
                        />
                    </svg>
                    <div className="ring-mid">
                        <Skeleton width={64} height={11} center />
                        <Skeleton width={118} height={24} shape="block" center marginTop={9} />
                        <Skeleton width={74} height={11} center marginTop={11} />
                    </div>
                </div>

                <div className="list">
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                </div>
            </main>
        </>
    );
}
