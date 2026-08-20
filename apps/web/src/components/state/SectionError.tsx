import { RetryButton } from './RetryButton';

/**
 * 조각 하나가 실패했을 때 그 자리에 앉는 카드 (U-07 · 시안 G · 화면정의서 §0.4)
 *
 * ⭐ **화면을 덮지 않는다.** Next 의 `error.tsx` 는 라우트 전체를 대체하므로
 *    "총 시간은 왔는데 태그별 분포만 실패" 같은 부분 실패를 표현할 수 없다.
 *    그래서 화면이 조회를 `try/catch` 로 감싸고 **실패한 섹션에만** 이걸 놓는다.
 *
 * ⭐ **아는 것은 지우지 않는다.** 분포가 실패했다고 총계까지 지우면
 *    "아무것도 모른다"가 되는데, 그건 사실이 아니다.
 *
 * ⚠️ `min-height` 로 정상 카드의 높이를 흉내 내는 이유:
 *    재시도가 성공하는 순간 위아래 요소가 튀지 않게 하려는 것이다.
 */

interface SectionErrorProps {
    /** 무엇이 안 됐는지. 시스템 용어를 쓰지 않는다 (화면정의서 §0.3) */
    title: string;
    /** 아직 무엇이 남아 있는지 — 사용자가 화면을 버리지 않게 한다 */
    detail: string;
    retryLabel?: string;
}

export function SectionError({ title, detail, retryLabel = '다시 불러오기' }: SectionErrorProps) {
    return (
        <section className="err-card" role="alert">
            <div>
                <svg
                    width="34"
                    height="34"
                    viewBox="0 0 34 34"
                    fill="none"
                    aria-hidden="true"
                    style={{ display: 'block', margin: '0 auto 14px', opacity: 0.5 }}
                >
                    <circle
                        cx="17"
                        cy="17"
                        r="13"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="3.5 4"
                    />
                </svg>

                <b>{title}</b>
                <p>{detail}</p>
                <RetryButton label={retryLabel} />
            </div>
        </section>
    );
}
