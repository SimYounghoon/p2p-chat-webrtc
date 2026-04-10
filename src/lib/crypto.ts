/**
 * AES-GCM 암호화 유틸리티
 *
 * - 키 파생  : PBKDF2 + SHA-256, 100,000 iterations
 * - 암호화   : AES-GCM 256-bit
 * - 직렬화   : salt(16B) ‖ iv(12B) ‖ ciphertext → base64url
 *
 * base64url 이므로 URL hash / query string 에 그대로 실을 수 있습니다.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Uint8Array → base64url */
function toBase64url(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** base64url → Uint8Array */
function fromBase64url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PBKDF2로 AES-GCM 키 파생 */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 평문을 암호문구로 암호화하여 base64url 문자열 반환
 * 구조: salt(16B) ‖ iv(12B) ‖ ciphertext → base64url
 */
export async function encryptText(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  const result = new Uint8Array(SALT_BYTES + IV_BYTES + ciphertextBuf.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_BYTES);
  result.set(new Uint8Array(ciphertextBuf), SALT_BYTES + IV_BYTES);
  return toBase64url(result);
}

/**
 * base64url 암호문을 암호문구로 복호화하여 평문 반환
 * 잘못된 암호문구 / 손상된 데이터일 경우 예외 발생
 */
export async function decryptText(ciphertext: string, passphrase: string): Promise<string> {
  try {
    const data = fromBase64url(ciphertext.trim());
    if (data.length <= SALT_BYTES + IV_BYTES) throw new Error('too short');

    const salt = data.slice(0, SALT_BYTES);
    const iv = data.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
    const encrypted = data.slice(SALT_BYTES + IV_BYTES);

    const key = await deriveKey(passphrase, salt);
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted,
    );
    return new TextDecoder().decode(plaintextBuf);
  } catch {
    throw new Error(
      '🔑 암호문구가 올바르지 않습니다. 호스트와 동일한 암호문구를 입력했는지 확인하세요.',
    );
  }
}
