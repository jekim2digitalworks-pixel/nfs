import { workDateOf, nowInAppZone, minutesUntilMidnight } from '@nfs/domain/time';

/**
 * O-02 스캐폴딩 확인용 임시 화면.
 * U-02(토큰 CSS + 루트 셸) 착수 시 통째로 교체된다.
 *
 * 여기서 확인하는 것: 서버 컴포넌트가 packages/domain 을 실제로 쓸 수 있는가.
 */
export default function Home() {
    const now = nowInAppZone();

    return (
        <main style={{ padding: 32, fontFamily: 'system-ui', lineHeight: 1.8 }}>
            <h1>NFS — Not For Sale</h1>
            <p>시간은 돈으로 살 수 없다.</p>
            <hr />
            <p>
                오늘(work_date): <strong>{workDateOf(now)}</strong>
            </p>
            <p>
                자정까지 남은 시간: <strong>{minutesUntilMidnight(now)}분</strong>
            </p>
        </main>
    );
}
