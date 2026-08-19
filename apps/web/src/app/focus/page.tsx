/**
 * S-04 집중 진입점 — 실제 화면은 /focus/[blockId] 이고 U-05 에서 만든다.
 * 진행 중인 블록이 없으면 하루 화면으로 보내는 것이 최종 동작이다.
 */
export default function FocusPage() {
    return (
        <>
            <div className="bloom" style={{ ['--bloom-color' as string]: 'rgba(124,140,255,.34)', ['--bloom-y' as string]: '45%' }} />

            <main className="screen">
                <h1 style={{ fontSize: 'var(--t-title)', fontWeight: 600, letterSpacing: '-.035em', marginTop: 24 }}>
                    집중
                </h1>
                <p style={{ color: 'var(--tx3)', fontSize: 'var(--t-caption)' }}>U-05 에서 만듭니다</p>
            </main>
        </>
    );
}
