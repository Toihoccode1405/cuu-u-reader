/**
 * =============================================================================
 * ZERO-KNOWLEDGE ENCRYPTION & AUTHENTICATION ENGINE
 * Standard Web Cryptography API (Hardware-accelerated AES-GCM-256 & PBKDF2)
 * =============================================================================
 */

const PBKDF2_ITERATIONS = 100000;

// Generate random salt/IV
export function getRandomBytes(length = 16) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

// Convert buffer to hex/base64 and vice versa
export function bufToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToBuf(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Derive AES-GCM Key from User Password using PBKDF2
export async function deriveKeyFromPassword(password, saltBase64) {
  const enc = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey', 'deriveBits']
  );

  const saltBuf = base64ToBuf(saltBase64);

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuf,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Create verification hash of password to check if password is correct without storing password
export async function createPasswordVerifier(password, saltBase64) {
  const enc = new TextEncoder();
  const saltBuf = new Uint8Array(base64ToBuf(saltBase64));
  const passBuf = enc.encode(password);

  const combined = new Uint8Array(saltBuf.length + passBuf.length);
  combined.set(saltBuf, 0);
  combined.set(passBuf, saltBuf.length);

  const hashBuffer = await window.crypto.subtle.digest('SHA-256', combined);
  return bufToBase64(hashBuffer);
}

// Verify password against stored verifier
export async function verifyPassword(password, saltBase64, expectedVerifier) {
  const computed = await createPasswordVerifier(password, saltBase64);
  return computed === expectedVerifier;
}

// Encrypt plaintext string with AES-GCM-256
export async function encryptText(plaintext, cryptoKey) {
  const enc = new TextEncoder();
  const iv = getRandomBytes(12); // Standard 96-bit IV for AES-GCM
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    enc.encode(plaintext)
  );

  return {
    iv: bufToBase64(iv),
    data: bufToBase64(ciphertextBuffer),
  };
}

// Decrypt AES-GCM-256 encrypted payload
export async function decryptText(encryptedObj, cryptoKey) {
  const iv = base64ToBuf(encryptedObj.iv);
  const data = base64ToBuf(encryptedObj.data);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    cryptoKey,
    data
  );

  const dec = new TextDecoder();
  return dec.decode(decryptedBuffer);
}
