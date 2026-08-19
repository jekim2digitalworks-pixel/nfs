'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DayIcon, FocusIcon, ReportIcon } from './tab-icons';

/**
 * 하단에 떠 있는 탭. 세 화면을 오가는 유일한 수단이다.
 *
 * 깊이 줌(연속 배율 이동)은 MVP 에서 제외됐다 (N-013).
 * Phase 5 에서 되살릴 때 이 컴포넌트가 점프 목적지를 그대로 넘겨준다.
 *
 * 클라이언트 컴포넌트인 이유는 usePathname 하나 때문이다.
 * 경계를 잎사귀 쪽으로 밀어 화면 전체가 클라이언트가 되지 않게 한다.
 */

interface TabDefinition {
    href: string;
    label: string;
    icon: () => React.ReactElement;
}

const TABS: TabDefinition[] = [
    { href: '/', label: '리포트', icon: ReportIcon },
    { href: '/day', label: '하루', icon: DayIcon },
    { href: '/focus', label: '집중', icon: FocusIcon },
];

function isCurrentTab(pathname: string, href: string): boolean {
    if (href === '/') {
        return pathname === '/';
    }
    return pathname.startsWith(href);
}

export function FloatingTabs() {
    const pathname = usePathname();

    return (
        <nav className="tabs" aria-label="주요 화면">
            {TABS.map(function renderTab(tab) {
                const Icon = tab.icon;
                const current = isCurrentTab(pathname, tab.href);

                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        // aria-current 하나로 스타일과 접근성을 동시에 처리한다.
                        // .on 같은 클래스를 따로 두면 둘이 어긋날 수 있다.
                        aria-current={current ? 'page' : undefined}
                    >
                        <Icon />
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
