import 'server-only';
import { prisma } from '../prisma';
import { encryptRefreshToken } from '../auth/token-cipher';
import type { GoogleProfile } from '../auth/google-oauth';

/**
 * 회원 — 구글 로그인 단독이므로 가입과 로그인이 같은 흐름이다 (N-014).
 */

export interface UpsertResult {
    memberId: bigint;
    isNewMember: boolean;
}

/**
 * 구글 프로필로 회원을 찾거나 만든다.
 *
 * ⚠️ **식별 기준은 `googleUserId` 다. 이메일이 아니다.**
 *    구글 계정은 이메일을 바꿀 수 있고, 그때 이메일로 찾으면 같은 사람이
 *    새 회원으로 갈라져 과거 원장을 잃는다.
 *    반대로 계정 id 는 영구적이다.
 */
export async function upsertMemberFromGoogle(
    profile: GoogleProfile,
    refreshToken: string | null,
): Promise<UpsertResult> {
    const existing = await prisma.member.findUnique({
        where: { googleUserId: profile.googleUserId },
        select: { memberId: true },
    });

    // 리프레시 토큰은 첫 동의 때만 온다.
    // 재로그인에서 안 왔다고 기존 값을 null 로 덮으면 배치가 캘린더를 못 읽게 된다.
    const tokenFields: { googleRefreshToken?: string } = {};
    if (refreshToken !== null) {
        tokenFields.googleRefreshToken = encryptRefreshToken(refreshToken);
    }

    if (existing !== null) {
        await prisma.member.update({
            where: { memberId: existing.memberId },
            data: {
                // 이메일·이름은 구글 쪽이 최신이다. 매 로그인마다 맞춘다
                email: profile.email,
                displayName: profile.displayName,
                googleScopeLevel: 'READ_ONLY',
                ...tokenFields,
            },
        });
        return { memberId: existing.memberId, isNewMember: false };
    }

    const created = await prisma.member.create({
        data: {
            email: profile.email,
            displayName: profile.displayName,
            googleUserId: profile.googleUserId,
            googleScopeLevel: 'READ_ONLY',
            ...tokenFields,
        },
        select: { memberId: true },
    });

    return { memberId: created.memberId, isNewMember: true };
}

/** 화면 상단·설정에서 쓰는 최소 정보. 토큰은 절대 포함하지 않는다 */
export async function findMemberSummary(memberId: bigint) {
    return await prisma.member.findUnique({
        where: { memberId: memberId },
        select: {
            memberId: true,
            email: true,
            displayName: true,
            googleScopeLevel: true,
            calendarBackfilled: true,
        },
    });
}
