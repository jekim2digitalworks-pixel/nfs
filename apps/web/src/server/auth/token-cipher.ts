import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 구글 리프레시 토큰 암호화 (정책 §7 · 아키텍처 §9)
 *
 * 왜 평문으로 두지 않나:
 *   이 토큰 하나면 사용자의 캘린더를 언제든 읽을 수 있다. 만료도 없다(테스트 모드 7일 제외).
 *   DB 백업이 유출되거나 SQL 인젝션이 한 번 뚫리면 그 자체로 캘린더 전체가 넘어간다.
 *   컬럼 암호화는 그 사고를 **키 유출까지 겹쳐야** 성립하는 사고로 바꾼다.
 *
 * AES-256-GCM 을 쓰는 이유:
 *   GCM 은 암호화와 **무결성 검증**을 같이 한다.
 *   CBC 같은 모드는 공격자가 암호문을 조작해도 복호화가 그냥 되어버린다.
 *   여기서는 조작된 토큰을 구글에 보내는 일이 없어야 한다.
 *
 * 키는 SESSION_SECRET 에서 파생한다. 별도 환경변수를 늘리지 않기 위한 선택이고,
 * 도메인 분리를 위해 고정 라벨을 섞어 세션 서명 키와 다른 값이 되게 한다.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM 권장 길이
const KEY_LABEL = 'nfs:google-refresh-token:v1';

function encryptionKey(): Buffer {
    const secret = process.env['SESSION_SECRET'];

    if (secret === undefined || secret.length < 16) {
        throw new Error('SESSION_SECRET 이 없거나 너무 짧습니다.');
    }

    // 라벨을 섞어 세션 서명에 쓰는 키와 다른 값을 만든다.
    // 같은 키를 두 용도로 쓰면 한쪽이 뚫릴 때 다른 쪽도 같이 무너진다.
    return createHash('sha256').update(`${KEY_LABEL}:${secret}`).digest();
}

/**
 * 저장 형식: `iv.authTag.ciphertext` (전부 base64url)
 *
 * 버전 접두사를 두지 않은 대신 KEY_LABEL 에 `v1` 을 넣었다.
 * 알고리즘을 바꿔야 하면 라벨을 올리고 마이그레이션에서 재암호화한다.
 */
export function encryptRefreshToken(plainToken: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

    const ciphertext = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        iv.toString('base64url'),
        authTag.toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

/**
 * 복호화. 형식이 깨졌거나 변조됐으면 **null 을 돌려준다.**
 *
 * 예외를 던지지 않는 이유: 이 값이 깨지는 건 배치 도중에 드러나는데,
 * 거기서 예외가 나면 한 사람 때문에 전체 배치가 멈춘다.
 * 호출부가 "재연동이 필요하다"로 처리할 수 있게 null 로 돌려준다 (N-028).
 */
export function decryptRefreshToken(stored: string): string | null {
    const parts = stored.split('.');
    if (parts.length !== 3) {
        return null;
    }

    const [ivText, authTagText, ciphertextText] = parts as [string, string, string];

    try {
        const decipher = createDecipheriv(
            ALGORITHM,
            encryptionKey(),
            Buffer.from(ivText, 'base64url'),
        );
        decipher.setAuthTag(Buffer.from(authTagText, 'base64url'));

        const plain = Buffer.concat([
            decipher.update(Buffer.from(ciphertextText, 'base64url')),
            decipher.final(),
        ]);
        return plain.toString('utf8');
    } catch {
        // 변조됐거나 키가 바뀌었다. 어느 쪽이든 이 토큰은 못 쓴다.
        return null;
    }
}
