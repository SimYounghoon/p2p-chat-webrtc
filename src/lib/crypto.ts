/**
 * AES-GCM 암호화 유틸리티 (v2: 압축 후 암호화)
 *
 * - 압축    : CompressionStream('deflate-raw') — 평문을 먼저 압축해 payload 크기를 줄임
 * - 키 파생  : PBKDF2 + SHA-256, 100,000 iterations
 * - 암호화   : AES-GCM 256-bit
 * - 직렬화   : salt(16B) ‖ iv(12B) ‖ ciphertext → base64url
 * - 버전 마커: "z2:" prefix — 구형 비압축 payload와 구분
 *
 * base64url 이므로 URL hash / query string 에 그대로 실을 수 있습니다.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** v2 압축 payload 판별 prefix */
const V2_PREFIX = 'z2:';

// ─── 압축 / 해제 ──────────────────────────────────────────────────

/** Uint8Array → deflate-raw 압축 Uint8Array */
async function compress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** deflate-raw 압축 Uint8Array → 원본 Uint8Array */
async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ─── base64url 변환 ────────────────────────────────────────────────

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

// ─── 키 파생 ───────────────────────────────────────────────────────

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

// ─── 공개 API ──────────────────────────────────────────────────────

/**
 * 평문을 압축(deflate-raw) 후 암호문구로 암호화하여 base64url 문자열 반환
 *
 * 출력 형식: "z2:<base64url>"
 * 구조: salt(16B) ‖ iv(12B) ‖ ciphertext(compressed_plaintext) → base64url
 *
 * 압축 효과:
 *   - WebRTC SDP JSON (~2,000자) → deflate-raw → ~600-800 bytes
 *   - 최종 payload 길이: 구형 대비 약 70% 감소
 */
export async function encryptText(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);

  // 압축 후 암호화
  const raw = new TextEncoder().encode(plaintext);
  const compressed = await compress(raw);

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    compressed,
  );

  const result = new Uint8Array(SALT_BYTES + IV_BYTES + ciphertextBuf.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_BYTES);
  result.set(new Uint8Array(ciphertextBuf), SALT_BYTES + IV_BYTES);
  return V2_PREFIX + toBase64url(result);
}

/**
 * base64url 암호문을 암호문구로 복호화하여 평문 반환
 *
 * "z2:" prefix가 있으면 복호화 후 압축 해제(v2).
 * prefix가 없으면 구형 비압축 포맷으로 처리(하위 호환).
 *
 * 잘못된 암호문구 / 손상된 데이터 / 압축 해제 실패 시 에러 메시지와 함께 예외 발생.
 */
export async function decryptText(ciphertext: string, passphrase: string): Promise<string> {
  try {
    const raw = ciphertext.trim();
    const isV2 = raw.startsWith(V2_PREFIX);
    const encoded = isV2 ? raw.slice(V2_PREFIX.length) : raw;

    const data = fromBase64url(encoded);
    if (data.length <= SALT_BYTES + IV_BYTES) throw new Error('too short');

    const salt = data.slice(0, SALT_BYTES);
    const iv = data.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
    const encrypted = data.slice(SALT_BYTES + IV_BYTES);

    const key = await deriveKey(passphrase, salt);
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted,
    );

    if (isV2) {
      // v2: 복호화 후 압축 해제
      const decompressed = await decompress(new Uint8Array(decryptedBuf));
      return new TextDecoder().decode(decompressed);
    }

    // v1 (구형 포맷): 압축 해제 없이 바로 텍스트 변환
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    throw new Error(
      '🔑 암호문구가 올바르지 않습니다. 호스트와 동일한 암호문구를 입력했는지 확인하세요.',
    );
  }
}
