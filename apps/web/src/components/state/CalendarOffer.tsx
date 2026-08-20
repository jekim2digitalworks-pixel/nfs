/**
 * 구글 캘린더 연결 제안 배너 (U-07 · 시안 G · N-037)
 *
 * ⭐ **미연동은 에러가 아니다.** 경고색을 쓰지 않는다 —
 *    `--warn` 을 칠하면 사용자는 자기가 뭘 잘못한 줄 안다. 사고가 아니라 제안이다.
 *
 * ⭐ **놓는 자리가 문구만큼 중요하다.** 화면 맨 아래가 아니라 기간 세그먼트 **바로 아래**다.
 *    "일정 시간이 왜 안 보이지"라는 질문이 생기는 자리에 답을 붙인다 —
 *    질문과 답이 떨어져 있으면 아무도 잇지 않는다. (화면정의서 S-02 의 "하단"을 바꾼 것 · N-037)
 *
 * 브라우저를 구글 동의 화면으로 보내므로 `<Link>` 가 아니라 `<a>` 다.
 */

export function CalendarOffer() {
    return (
        <a className="offer" href="/api/auth/google/start">
            <span className="offer__icon" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                    <rect
                        x="1.5"
                        y="3"
                        width="14"
                        height="12.5"
                        rx="3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    />
                    <path
                        d="M1.5 7h14M5.5 1.5V4M11.5 1.5V4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                    />
                </svg>
            </span>

            <span className="offer__txt">
                <b>구글 캘린더를 연결하면</b>
                <span>회의·약속에 쓴 일정 시간도 함께 보입니다</span>
            </span>

            <span className="offer__go" aria-hidden="true">
                <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
                    <path
                        d="M1.5 1.5 6.5 6.5l-5 5"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </span>
        </a>
    );
}
