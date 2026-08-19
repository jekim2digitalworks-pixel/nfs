/**
 * S-03 하루 — U-04 에서 만든다.
 * 지금은 탭 이동과 화면별 블룸 차이를 확인하는 용도다.
 */
export default function DayPage() {
    return (
        <>
            {/* 화면마다 블룸의 위치와 색만 다르다. 나머지 구조는 자유롭게 달라진다 (N-009) */}
            <div className="bloom" style={{ ['--bloom-color' as string]: 'rgba(255,176,32,.20)', ['--bloom-y' as string]: '42%' }} />
            <div className="bloom-2" style={{ ['--bloom2-color' as string]: 'rgba(124,140,255,.15)' }} />

            <main className="screen screen-day">
                <h1 style={{ fontSize: 'var(--t-title)', fontWeight: 600, letterSpacing: '-.035em', marginTop: 24 }}>
                    하루
                </h1>
                <p style={{ color: 'var(--tx3)', fontSize: 'var(--t-caption)' }}>U-04 에서 만듭니다</p>
            </main>
        </>
    );
}
