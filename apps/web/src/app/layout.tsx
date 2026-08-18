import type { Metadata, Viewport } from 'next';
import './globals.css';

/**
 * NFS 화면은 전부 '지금'과 로그인한 회원에 의존한다. 정적 프리렌더 대상이 하나도 없다.
 *
 * 이걸 명시하지 않으면 빌드 시점의 날짜가 박제된 HTML 이 배포된다.
 * (O-02 검증 중 실제로 재현했다 — 루트 페이지가 ○ Static 으로 잡혔다)
 *
 * 회원 세션을 읽는 순간(await cookies()) 자동으로 동적이 되긴 하지만,
 * 그건 "우연히 그렇게 되는" 방어다. 의도를 한 곳에 적어둔다.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'NFS — Not For Sale',
    description: '시간은 돈으로 살 수 없다. 시간 가계부 + 마이크로 타임박싱',
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    // safe-area-inset-* 계산이 여기 달렸다. 빼면 하단 탭이 홈 인디케이터에 깔린다.
    viewportFit: 'cover',
    themeColor: '#08080B',
};

export default function RootLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="ko">
            <body>{children}</body>
        </html>
    );
}
