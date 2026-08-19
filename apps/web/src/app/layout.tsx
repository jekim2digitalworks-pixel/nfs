import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Noto_Sans_KR } from 'next/font/google';
import { FloatingTabs } from '@/components/layout/FloatingTabs';
import './globals.css';

/**
 * NFS 화면은 전부 '지금'과 로그인한 회원에 의존한다. 정적 프리렌더 대상이 하나도 없다.
 *
 * 이걸 명시하지 않으면 빌드 시점의 날짜가 박제된 HTML 이 배포된다.
 * (O-02 검증 중 실제로 재현했다 — 루트 페이지가 ○ Static 으로 잡혔다)
 */
export const dynamic = 'force-dynamic';

/**
 * 서체는 next/font 로 셀프 호스팅한다. CDN 링크를 쓰면 폰트가 늦게 와서
 * 레이아웃이 한 번 튄다(CLS) — 숫자가 주인공인 앱에서 특히 눈에 띈다.
 *
 * Instrument Sans 는 라틴·숫자, Noto Sans KR 은 한글을 받는다.
 * 스택 순서만으로 갈리므로 역할별로 다른 패밀리를 섞지 않는다.
 */
const instrumentSans = Instrument_Sans({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-latin',
});

const notoSansKr = Noto_Sans_KR({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-ko',
});

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
        <html lang="ko" className={`${instrumentSans.variable} ${notoSansKr.variable}`}>
            <body>
                {children}
                <FloatingTabs />
            </body>
        </html>
    );
}
