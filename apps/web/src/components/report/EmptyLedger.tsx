import Link from 'next/link';
import { Ring } from '@/components/chart/Ring';

/**
 * 기록이 0 인 기간 (시안 G · N-037)
 *
 * ⭐ **62px 로 `0시간 0분` 을 쓰지 않는다.** 히어로 숫자는 성취를 재는 자리라,
 *    거기 0 을 크게 박으면 *"아직 시작 전"* 이 *"이미 실패"* 로 읽힌다.
 * ⭐ **링을 지우지 않는다.** 지우면 이 화면이 무엇을 하는 곳인지 배울 기회를 잃는다.
 *    다만 값이 없으므로 색 조각도 얹지 않는다 — 값 없이 색을 칠하면 차트가 거짓말을 한다.
 */
export function EmptyLedger({
    periodLabel,
    calendarConnected,
}: {
    periodLabel: string;
    calendarConnected: boolean;
}) {
    return (
        <div className="empty-lead">
            <Ring segments={[]} caption="가장 많이 쓴 곳" value="아직 없음" subValue={periodLabel} valueMuted />

            <section className="empty-cta">
                <h2>{periodLabel}은 아직 비어 있습니다</h2>
                <p>
                    블록을 하나 만들어 25분을 실제로 살아보세요.
                    <br />
                    끝나는 순간 이 링에 첫 조각이 생깁니다.
                </p>
                {calendarConnected ? (
                    <p className="empty-cta__sub">
                        기록은 타이머가 돈 시간과 캘린더 일정에서 함께 쌓입니다.
                    </p>
                ) : null}

                <Link className="btn btn--primary btn--inline" href="/day">
                    오늘 계획하기
                </Link>
            </section>
        </div>
    );
}
