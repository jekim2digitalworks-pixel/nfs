import { nowInAppZone, workDateOf } from '@nfs/domain/time';

/**
 * S-02 리포트 — U-02 단계의 셸 확인용.
 * 실제 화면(히어로 · 링 · 목록)은 U-03 에서 만든다.
 */
export default function ReportPage() {
    const now = nowInAppZone();

    return (
        <>
            <div className="bloom" />
            <div className="bloom-2" />

            <main className="screen">
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBlock: 10 }}>
                    <button type="button" className="chip">
                        {now.toFormat('yyyy년 M월')}
                    </button>
                </header>

                <p style={{ color: 'var(--tx2)', fontSize: 'var(--t-label)', margin: '26px 0 6px' }}>
                    이번 달에 쓴 시간
                </p>
                <h1
                    className="num"
                    style={{ fontSize: 'var(--t-hero)', fontWeight: 600, letterSpacing: '-.045em', margin: 0, lineHeight: 1 }}
                >
                    0<em>시간</em>
                </h1>

                <p style={{ color: 'var(--tx3)', fontSize: 'var(--t-caption)', marginTop: 14 }}>
                    아직 기록이 없습니다 · {workDateOf(now)}
                </p>

                <section className="card" style={{ marginTop: 26 }}>
                    <p style={{ margin: 0, color: 'var(--tx2)', fontSize: 'var(--t-body)' }}>
                        당신에게 50년이 남았다면 <strong className="num" style={{ color: 'var(--tx)' }}>438,000</strong>시간입니다.
                    </p>
                    <p style={{ margin: '10px 0 0', color: 'var(--tx3)', fontSize: 'var(--t-caption)' }}>
                        이 시간은 어디서도 살 수 없습니다. Not For Sale.
                    </p>
                </section>
            </main>
        </>
    );
}
