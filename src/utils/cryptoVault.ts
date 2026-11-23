import type {
  ApiCredentials,
  ChannelSnapshot,
  DailyDeltaRecord,
  NetworkConfig,
  PostDetailedStats,
} from '../types/analytics';

const DB_NAME = 'tg_pulse_vault_v1';
const DB_VERSION = 1;
const STORE_VAULT = 'vault';
const STORE_SNAPSHOTS = 'snapshots';

const SESSION_KEY = 'encrypted_session_v1';
const API_CREDS_KEY = 'api_credentials_v1';
const NETWORK_KEY = 'network_config_v1';
const LS_FALLBACK_PREFIX = 'telescope_vault_fb_';

export type VaultErrorCode =
  | 'PIN_REQUIRED'
  | 'WRONG_PIN'
  | 'SESSION_NOT_FOUND'
  | 'CRYPTO_UNAVAILABLE'
  | 'CORRUPT_VAULT'
  | 'PIN_LOCKED';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export interface VaultSecretBundle {
  sessionString: string;
  apiCreds?: ApiCredentials;
  network?: NetworkConfig;
}

export interface EncryptedPayload {
  salt: string;
  iv: string;
  ciphertext: string;
  hasPin: boolean;
  savedAt: number;
  formatVersion?: number;
}

export const PBKDF2_ITERATIONS_V3 = 600_000;
export const PBKDF2_ITERATIONS_LEGACY = 120_000;
const DEVICE_SECRET_STORAGE_KEY = 'tg_pulse_device_entropy_v2';
const PIN_LOCKOUT_STORAGE_KEY = 'tg_pulse_pin_lockout_v1';

let ephemeralRuntimeSecret: string | null = null;
let failedPinAttempts = 0;
let pinLockoutUntil = 0;

function syncLockoutFromStorage(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(PIN_LOCKOUT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { attempts?: number; until?: number };
        failedPinAttempts = Math.max(failedPinAttempts, Number(parsed.attempts) || 0);
        pinLockoutUntil = Math.max(pinLockoutUntil, Number(parsed.until) || 0);
      }
    }
  } catch {
    // ignore storage read errors
  }
}

function persistLockoutToStorage(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        PIN_LOCKOUT_STORAGE_KEY,
        JSON.stringify({ attempts: failedPinAttempts, until: pinLockoutUntil }),
      );
    }
  } catch {
    // ignore storage write errors
  }
}

export function checkPinLockout(): { locked: boolean; remainingSec: number } {
  syncLockoutFromStorage();
  const now = Date.now();
  if (pinLockoutUntil > now) {
    return { locked: true, remainingSec: Math.ceil((pinLockoutUntil - now) / 1000) };
  }
  return { locked: false, remainingSec: 0 };
}

export function resetPinLockout(): void {
  failedPinAttempts = 0;
  pinLockoutUntil = 0;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(PIN_LOCKOUT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getOrCreateLocalDeviceSecret(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      let secret = window.localStorage.getItem(DEVICE_SECRET_STORAGE_KEY);
      if (!secret || secret.length < 32) {
        const rand = globalThis.crypto.getRandomValues(new Uint8Array(32));
        secret = bytesToBase64(rand);
        window.localStorage.setItem(DEVICE_SECRET_STORAGE_KEY, secret);
      }
      return secret;
    }
  } catch {
    // Fallback to per-process random ephemeral key below
  }
  if (!ephemeralRuntimeSecret) {
    const rand = globalThis.crypto.getRandomValues(new Uint8Array(32));
    ephemeralRuntimeSecret = bytesToBase64(rand);
  }
  return ephemeralRuntimeSecret;
}

/**
 * Normalizes Persian (۰-۹) and Arabic-Indic (٠-٩) numerals to ASCII 0-9 and trims whitespace.
 */
export function normalizePinDigits(raw: string): string {
  return raw
    .trim()
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new VaultError(
      'CRYPTO_UNAVAILABLE',
      'WebCrypto AES-GCM requires a secure context (HTTPS or localhost).',
    );
  }
  return cryptoObj.subtle;
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS_V3,
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const encoder = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function parseDecryptedVaultSecret(plaintext: string): VaultSecretBundle {
  const trimmed = plaintext.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        v?: number;
        sessionString?: string;
        apiCreds?: ApiCredentials;
        network?: NetworkConfig;
      };
      if (typeof parsed.sessionString === 'string' && parsed.sessionString.length > 0) {
        return {
          sessionString: parsed.sessionString,
          apiCreds: parsed.apiCreds,
          network: parsed.network,
        };
      }
    } catch {
      // Fallback to raw v1 session string
    }
  }
  return { sessionString: plaintext };
}

export async function encryptVaultBundle(
  bundle: VaultSecretBundle,
  pin?: string,
): Promise<EncryptedPayload> {
  const subtle = getSubtleCrypto();
  const normalizedPin = pin ? normalizePinDigits(pin) : '';
  const hasPin = normalizedPin.length > 0;
  const secret = hasPin ? normalizedPin : getOrCreateLocalDeviceSecret();

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(secret, salt);

  const envelope = JSON.stringify({
    v: 2,
    sessionString: bundle.sessionString,
    apiCreds: bundle.apiCreds,
    network: bundle.network,
  });
  const encoded = new TextEncoder().encode(envelope);
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    hasPin,
    savedAt: Date.now(),
    formatVersion: 3,
  };
}

export async function decryptVaultPayload(
  payload: EncryptedPayload,
  pin?: string,
): Promise<VaultSecretBundle> {
  const subtle = getSubtleCrypto();

  if (payload.hasPin) {
    const lockout = checkPinLockout();
    if (lockout.locked) {
      throw new VaultError(
        'PIN_LOCKED',
        `Too many incorrect PIN attempts. Locked for ${lockout.remainingSec}s to prevent brute-force.`,
      );
    }

    const rawTrimmed = (pin ?? '').trim();
    const normalized = normalizePinDigits(rawTrimmed);
    if (!rawTrimmed && !normalized) {
      throw new VaultError('PIN_REQUIRED', 'PIN_REQUIRED');
    }

    const candidates = normalized && normalized !== rawTrimmed ? [normalized, rawTrimmed] : [normalized];
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const ciphertext = base64ToBytes(payload.ciphertext);

    const iterationTiers =
      payload.formatVersion && payload.formatVersion >= 3
        ? [PBKDF2_ITERATIONS_V3, PBKDF2_ITERATIONS_LEGACY]
        : [PBKDF2_ITERATIONS_LEGACY, PBKDF2_ITERATIONS_V3];

    for (const iter of iterationTiers) {
      for (const candidate of candidates) {
        try {
          const key = await deriveAesKey(candidate, salt, iter);
          const decrypted = await subtle.decrypt(
            { name: 'AES-GCM', iv: iv as BufferSource },
            key,
            ciphertext as BufferSource,
          );
          const text = new TextDecoder().decode(decrypted);
          resetPinLockout();
          return parseDecryptedVaultSecret(text);
        } catch {
          // try next
        }
      }
    }

    failedPinAttempts += 1;
    if (failedPinAttempts >= 5) {
      const penaltySec = Math.min(900, 30 * Math.pow(2, failedPinAttempts - 5));
      pinLockoutUntil = Date.now() + penaltySec * 1000;
    }
    persistLockoutToStorage();
    throw new VaultError('WRONG_PIN', 'WRONG_PIN');
  }

  // Device-locked payload (No PIN)
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);

  const deviceSecretsToTry = [getOrCreateLocalDeviceSecret()];

  const iterationTiers =
    payload.formatVersion && payload.formatVersion >= 3
      ? [PBKDF2_ITERATIONS_V3, PBKDF2_ITERATIONS_LEGACY]
      : [PBKDF2_ITERATIONS_LEGACY, PBKDF2_ITERATIONS_V3];

  for (const iter of iterationTiers) {
    for (const sec of deviceSecretsToTry) {
      try {
        const key = await deriveAesKey(sec, salt, iter);
        const decrypted = await subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          key,
          ciphertext as BufferSource,
        );
        const text = new TextDecoder().decode(decrypted);
        return parseDecryptedVaultSecret(text);
      } catch {
        // try next
      }
    }
  }

  throw new VaultError('CORRUPT_VAULT', 'Failed to decrypt locally saved session payload.');
}

let cachedDbPromise: Promise<IDBDatabase> | null = null;

function openVaultDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (cachedDbPromise) return cachedDbPromise;

  cachedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_VAULT)) {
          db.createObjectStore(STORE_VAULT);
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          db.createObjectStore(STORE_SNAPSHOTS);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          cachedDbPromise = null;
        };
        db.onclose = () => {
          cachedDbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        cachedDbPromise = null;
        reject(req.error ?? new Error('Failed to open IndexedDB'));
      };
      req.onblocked = () => {
        cachedDbPromise = null;
        reject(new Error('IndexedDB open blocked by another connection'));
      };
    } catch (err) {
      cachedDbPromise = null;
      reject(err);
    }
  });

  return cachedDbPromise;
}

function readLocalFallback<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${LS_FALLBACK_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocalFallback<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`${LS_FALLBACK_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

function deleteLocalFallback(key: string): void {
  try {
    localStorage.removeItem(`${LS_FALLBACK_PREFIX}${key}`);
  } catch {
    // ignore
  }
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openVaultDb();
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (result !== null) return result;
  } catch {
    // fallback to localStorage below
  }

  if (storeName === STORE_VAULT) {
    return readLocalFallback<T>(key);
  }
  return null;
}

async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      const store = tx.objectStore(storeName);
      store.put(value, key);
    });
    if (storeName === STORE_VAULT) {
      // Remove any stale localStorage fallback copy once IndexedDB succeeds
      deleteLocalFallback(key);
    }
  } catch (err) {
    if (storeName === STORE_VAULT) {
      // Only use localStorage fallback when IndexedDB is blocked/unavailable (e.g. restrictive iframe)
      writeLocalFallback(key, value);
      return;
    }
    throw err;
  }
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  if (storeName === STORE_VAULT) {
    deleteLocalFallback(key);
  }
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'));
      const store = tx.objectStore(storeName);
      store.delete(key);
    });
  } catch {
    // ignore if db unavailable
  }
}

export async function saveEncryptedSessionBundle(
  bundle: VaultSecretBundle,
  pin?: string,
): Promise<{ hasPin: boolean; savedAt: number }> {
  const payload = await encryptVaultBundle(bundle, pin);
  await idbSet(STORE_VAULT, SESSION_KEY, payload);
  return { hasPin: payload.hasPin, savedAt: payload.savedAt };
}

export async function saveEncryptedSession(
  sessionString: string,
  pin?: string,
): Promise<void> {
  await saveEncryptedSessionBundle({ sessionString }, pin);
}

export async function getSavedSessionMeta(): Promise<{
  exists: boolean;
  hasPin: boolean;
  savedAt?: number;
}> {
  try {
    const payload = await idbGet<EncryptedPayload>(STORE_VAULT, SESSION_KEY);
    if (!payload || !payload.ciphertext) return { exists: false, hasPin: false };
    return { exists: true, hasPin: Boolean(payload.hasPin), savedAt: payload.savedAt };
  } catch {
    return { exists: false, hasPin: false };
  }
}

export async function loadEncryptedSessionBundle(pin?: string): Promise<VaultSecretBundle> {
  const payload = await idbGet<EncryptedPayload>(STORE_VAULT, SESSION_KEY);
  if (!payload || !payload.ciphertext) {
    throw new VaultError('SESSION_NOT_FOUND', 'No saved session found');
  }
  return decryptVaultPayload(payload, pin);
}

export async function loadEncryptedSession(pin?: string): Promise<string | null> {
  const payload = await idbGet<EncryptedPayload>(STORE_VAULT, SESSION_KEY);
  if (!payload) return null;
  const bundle = await decryptVaultPayload(payload, pin);
  return bundle.sessionString;
}

export async function clearSavedSession(): Promise<void> {
  await idbDelete(STORE_VAULT, SESSION_KEY);
}

export function sanitizeNetworkForUnencryptedStorage(config: NetworkConfig): NetworkConfig {
  return {
    ...config,
    cfRelayToken: '',
    socks5: {
      ...config.socks5,
      // Never persist secrets in plaintext storage; they are only stored encrypted inside the PIN-protected vault bundle.
      password: '',
      bridgeToken: '',
    },
  };
}

export async function saveNetworkConfig(config: NetworkConfig): Promise<void> {
  await idbSet(STORE_VAULT, NETWORK_KEY, sanitizeNetworkForUnencryptedStorage(config));
}

export async function loadNetworkConfig(): Promise<NetworkConfig | null> {
  try {
    return await idbGet<NetworkConfig>(STORE_VAULT, NETWORK_KEY);
  } catch {
    return null;
  }
}

export async function saveApiCredentials(creds: ApiCredentials): Promise<void> {
  if (!creds.apiId && !creds.apiHash) {
    await idbDelete(STORE_VAULT, API_CREDS_KEY);
    return;
  }
  const encrypted = await encryptVaultBundle({
    sessionString: JSON.stringify({ apiId: creds.apiId, apiHash: creds.apiHash }),
  });
  await idbSet(STORE_VAULT, API_CREDS_KEY, encrypted);
}

export async function loadApiCredentials(): Promise<ApiCredentials | null> {
  try {
    const raw = await idbGet<EncryptedPayload | ApiCredentials>(STORE_VAULT, API_CREDS_KEY);
    if (!raw) return null;
    if ('ciphertext' in raw && typeof raw.ciphertext === 'string') {
      const bundle = await decryptVaultPayload(raw);
      const parsed = JSON.parse(bundle.sessionString) as Partial<ApiCredentials>;
      if (typeof parsed.apiId === 'number' && typeof parsed.apiHash === 'string') {
        return { apiId: parsed.apiId, apiHash: parsed.apiHash };
      }
      return null;
    }
    if ('apiId' in raw && typeof raw.apiId === 'number') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export interface StoredChannelHistory {
  latestSnapshot: ChannelSnapshot | null;
  dailyDeltas: DailyDeltaRecord[];
  postStatsByPost?: Record<string, PostDetailedStats>;
}

interface StoredChannelMeta {
  latestSnapshot: ChannelSnapshot | null;
  dailyDeltas: DailyDeltaRecord[];
}

export async function saveChannelMetaHistory(
  channelId: number,
  latestSnapshot: ChannelSnapshot | null,
  dailyDeltas: DailyDeltaRecord[],
): Promise<void> {
  await idbSet<StoredChannelMeta>(STORE_SNAPSHOTS, `ch:${channelId}:meta`, {
    latestSnapshot,
    dailyDeltas: dailyDeltas.slice(-2000),
  });
}

export async function saveChannelPostStats(
  channelId: number,
  postStatsByPost: Record<string, PostDetailedStats>,
): Promise<void> {
  await idbSet(STORE_SNAPSHOTS, `ch:${channelId}:stats`, postStatsByPost);
}

export async function saveChannelSnapshotHistory(
  channelId: number,
  history: StoredChannelHistory,
): Promise<void> {
  await saveChannelMetaHistory(channelId, history.latestSnapshot, history.dailyDeltas);
  if (history.postStatsByPost) {
    await saveChannelPostStats(channelId, history.postStatsByPost);
  }
}

export async function loadChannelSnapshotHistory(
  channelId: number,
): Promise<StoredChannelHistory | null> {
  try {
    const [meta, stats] = await Promise.all([
      idbGet<StoredChannelMeta>(STORE_SNAPSHOTS, `ch:${channelId}:meta`),
      idbGet<Record<string, PostDetailedStats>>(STORE_SNAPSHOTS, `ch:${channelId}:stats`),
    ]);
    if (meta || stats) {
      return {
        latestSnapshot: meta?.latestSnapshot ?? null,
        dailyDeltas: meta?.dailyDeltas ?? [],
        postStatsByPost: stats ?? {},
      };
    }
    // Legacy single-record fallback
    return await idbGet<StoredChannelHistory>(STORE_SNAPSHOTS, `ch:${channelId}`);
  } catch {
    return null;
  }
}

export async function wipeAllVaultData(): Promise<void> {
  resetPinLockout();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(DEVICE_SECRET_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  for (const key of [SESSION_KEY, API_CREDS_KEY, NETWORK_KEY]) {
    deleteLocalFallback(key);
  }
  try {
    const db = await openVaultDb();
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_VAULT, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE_VAULT).clear();
      }),
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE_SNAPSHOTS).clear();
      }),
    ]);
  } catch {
    // ignore if db unavailable
  }
}
