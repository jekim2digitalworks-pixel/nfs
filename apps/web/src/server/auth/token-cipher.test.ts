import { beforeAll, describe, expect, it } from 'vitest';
import { decryptRefreshToken, encryptRefreshToken } from './token-cipher';

beforeAll(() => {
    process.env['SESSION_SECRET'] = 'test-secret-at-least-sixteen-chars-long';
});

describe('구글 리프레시 토큰 암호화', () => {
    it('왕복하면 원본이 나온다', () => {
        const original = '1//0eXaMpLe-refresh-token_value';

        expect(decryptRefreshToken(encryptRefreshToken(original))).toBe(original);
    });

    it('같은 값을 두 번 암호화해도 암호문이 다르다 (IV 가 매번 새롭다)', () => {
        // 같은 결과가 나오면 DB 만 보고 "이 둘은 같은 토큰"임을 알 수 있게 된다
        const a = encryptRefreshToken('same-token');
        const b = encryptRefreshToken('same-token');

        expect(a).not.toBe(b);
        expect(decryptRefreshToken(a)).toBe(decryptRefreshToken(b));
    });

    it('암호문에 원본이 남아 있지 않다', () => {
        const encrypted = encryptRefreshToken('super-secret-token');

        expect(encrypted).not.toContain('super-secret-token');
    });

    it('⭐ 변조되면 예외가 아니라 null 을 돌려준다', () => {
        // 배치 도중에 드러나는 값이다. 예외를 던지면 한 사람 때문에 전체 배치가 멈춘다.
        const encrypted = encryptRefreshToken('token');
        const parts = encrypted.split('.');
        const tampered = `${parts[0]}.${parts[1]}.${Buffer.from('공격자가 넣은 값').toString('base64url')}`;

        expect(decryptRefreshToken(tampered)).toBeNull();
    });

    it('형식이 깨져도 null 이다', () => {
        expect(decryptRefreshToken('쓰레기')).toBeNull();
        expect(decryptRefreshToken('a.b')).toBeNull();
        expect(decryptRefreshToken('')).toBeNull();
    });

    it('키가 바뀌면 못 읽는다 (예전 데이터가 조용히 통과하지 않는다)', () => {
        const encrypted = encryptRefreshToken('token');
        process.env['SESSION_SECRET'] = 'a-completely-different-secret-key-value';

        expect(decryptRefreshToken(encrypted)).toBeNull();

        process.env['SESSION_SECRET'] = 'test-secret-at-least-sixteen-chars-long';
    });
});
