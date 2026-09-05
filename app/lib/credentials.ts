import CryptoJS from "crypto-js";

/**
 * Browser-side store for the AWS keys used to scan and remediate.
 *
 * Design notes, because the trade-offs here are not obvious:
 *
 * - Keys live in `sessionStorage`, not `localStorage`, so they are discarded
 *   when the tab closes instead of persisting on the device indefinitely.
 * - The entry is namespaced by Firebase UID and wiped on sign-out, so a second
 *   person using the same browser cannot inherit the previous user's keys.
 * - Values are encrypted with a random IV per operation. The key is shared with
 *   the bundle, so this protects against casual inspection of browser storage,
 *   accidental logging and passive capture -- it is NOT a defence against an
 *   attacker who can run script in the page. The durable fix is cross-account
 *   role assumption instead of long-lived keys.
 */

const STORAGE_PREFIX = "tuff.aws.";
const LEGACY_STORAGE_KEY = "aws_credentials";
const REGION_PREFERENCE_KEY = "tuff.region";
const CIPHER_VERSION = "v2";

const rawKey = process.env.NEXT_PUBLIC_ENCRYPTION_KEY ?? "";
const encryptionKey =
  rawKey.length >= 16 ? CryptoJS.enc.Utf8.parse(rawKey.padEnd(32, "0").substring(0, 32)) : null;

export const isEncryptionConfigured = encryptionKey !== null;

export interface AwsCredentials {
  accessKey: string;
  secretKey: string;
  region: string;
}

/** Ciphertext envelope: `v2.<base64 iv>.<base64 ciphertext>`. */
export function encryptValue(plaintext: string): string {
  if (!encryptionKey) {
    // The backend accepts plaintext outside production so local development
    // works without extra setup; it rejects it in production.
    return plaintext;
  }
  // A fresh IV per call: the previous implementation reused a constant IV,
  // which makes AES-CBC deterministic and leaks whether two values are equal.
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(plaintext, encryptionKey, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const ivB64 = CryptoJS.enc.Base64.stringify(iv);
  const ctB64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  return `${CIPHER_VERSION}.${ivB64}.${ctB64}`;
}

export function decryptValue(value: string): string | null {
  if (!value.startsWith(`${CIPHER_VERSION}.`)) {
    return value;
  }
  if (!encryptionKey) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;

  try {
    const iv = CryptoJS.enc.Base64.parse(parts[1]);
    const ciphertext = CryptoJS.enc.Base64.parse(parts[2]);
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext }),
      encryptionKey,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
    );
    const text = decrypted.toString(CryptoJS.enc.Utf8);
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

/** Encrypted credentials, ready to send to the API as-is. */
export interface EncryptedCredentials {
  accessKey: string;
  secretKey: string;
  region: string;
}

export function saveCredentials(userId: string, credentials: AwsCredentials): EncryptedCredentials {
  const payload: EncryptedCredentials = {
    accessKey: encryptValue(credentials.accessKey),
    secretKey: encryptValue(credentials.secretKey),
    region: credentials.region,
  };
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(storageKey(userId), JSON.stringify(payload));
      window.localStorage.setItem(REGION_PREFERENCE_KEY, credentials.region);
    } catch {
      // Storage can be unavailable (private mode, quota). Scanning still works
      // for the current page because the caller keeps the values in memory.
    }
  }
  return payload;
}

export function loadEncryptedCredentials(userId: string): EncryptedCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessKey || !parsed?.secretKey) return null;
    return {
      accessKey: parsed.accessKey,
      secretKey: parsed.secretKey,
      region: parsed.region || getPreferredRegion(),
    };
  } catch {
    return null;
  }
}

export function loadCredentials(userId: string): AwsCredentials | null {
  const stored = loadEncryptedCredentials(userId);
  if (!stored) return null;
  const accessKey = decryptValue(stored.accessKey);
  const secretKey = decryptValue(stored.secretKey);
  if (!accessKey || !secretKey) return null;
  return { accessKey, secretKey, region: stored.region };
}

export function hasCredentials(userId: string): boolean {
  return loadEncryptedCredentials(userId) !== null;
}

/** Remove every stored credential. Called on sign-out and on "disconnect". */
export function clearCredentials(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
    purgeLegacyCredentials();
  } catch {
    // Nothing actionable if storage is unavailable.
  }
}

/**
 * Delete credentials written by earlier versions.
 *
 * Those were kept in `localStorage` under a fixed key, encrypted with a
 * constant IV, and survived both sign-out and tab close.
 */
export function purgeLegacyCredentials(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export function getPreferredRegion(): string {
  if (typeof window === "undefined") return "us-east-1";
  try {
    return window.localStorage.getItem(REGION_PREFERENCE_KEY) || "us-east-1";
  } catch {
    return "us-east-1";
  }
}

export function setPreferredRegion(region: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REGION_PREFERENCE_KEY, region);
  } catch {
    // Ignore.
  }
}

const ACCESS_KEY_PATTERN = /^[A-Z0-9]{16,128}$/;

/** Catch obvious paste mistakes before spending a scan on them. */
export function validateCredentialInput(accessKey: string, secretKey: string): string | null {
  const trimmedAccess = accessKey.trim();
  const trimmedSecret = secretKey.trim();

  if (!trimmedAccess || !trimmedSecret) {
    return "Both the Access Key ID and the Secret Access Key are required.";
  }
  if (!ACCESS_KEY_PATTERN.test(trimmedAccess)) {
    return "That doesn't look like an AWS Access Key ID. It should be uppercase letters and digits, e.g. AKIA...";
  }
  if (trimmedSecret.length < 20) {
    return "That doesn't look like an AWS Secret Access Key — they are at least 20 characters long.";
  }
  return null;
}
