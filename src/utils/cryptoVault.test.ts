import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearChannelCache,
  decryptVaultPayload,
  encryptVaultBundle,
  loadApiCredentials,
  loadChannelPostStats,
  normalizePinDigits,
  PBKDF2_ITERATIONS_V3,
  POST_STATS_NORMALIZED_VERSION,
  resetPinLockout,
  sanitizeNetworkForUnencryptedStorage,
  saveApiCredentials,
  saveChannelPostStat,
  saveChannelPostStats,
  VaultError,
  wipeAllVaultData,
  type EncryptedPayload,
} from './cryptoVault';

test('encryptVaultBundle + decryptVaultPayload succeeds with 6+ char numeric PIN 774301', async () => {
  const payload = await encryptVaultBundle(
    {
      sessionString: 'v3-sample-mtproto-session-token-abc123',
      apiCreds: { apiId: 12345678, apiHash: '0123456789abcdef0123456789abcdef' },
    },
    '774301',
  );

  assert.equal(payload.hasPin, true);

  const decrypted = await decryptVaultPayload(payload, '774301');
  assert.equal(decrypted.sessionString, 'v3-sample-mtproto-session-token-abc123');
  assert.equal(decrypted.apiCreds?.apiId, 12345678);
  assert.equal(decrypted.apiCreds?.apiHash, '0123456789abcdef0123456789abcdef');
});

test('decryptVaultPayload normalizes Persian and Arabic numerals seamlessly', async () => {
  const payload = await encryptVaultBundle(
    { sessionString: 'persian-numeral-session' },
    '774301',
  );
  assert.equal(normalizePinDigits('۷۷۴۳۰۱'), '774301');

  const decrypted = await decryptVaultPayload(payload, '۷۷۴۳۰۱');
  assert.equal(decrypted.sessionString, 'persian-numeral-session');
});

test('encryptVaultBundle rejects < 6 char PINs with PIN_TOO_SHORT and repeated-char PINs with PIN_TOO_WEAK', async () => {
  for (const shortPin of ['1', '1234', '7743', '۱۲۳۴۵']) {
    await assert.rejects(
      () => encryptVaultBundle({ sessionString: 'short-pin-session' }, shortPin),
      (err: unknown) => err instanceof VaultError && err.code === 'PIN_TOO_SHORT',
    );
  }

  for (const weakPin of ['000000', 'aaaaaa', '۰۰۰۰۰۰', '11111111']) {
    await assert.rejects(
      () => encryptVaultBundle({ sessionString: 'weak-pin-session' }, weakPin),
      (err: unknown) => err instanceof VaultError && err.code === 'PIN_TOO_WEAK',
    );
  }
});

test('decryptVaultPayload continues to decrypt legacy < 6 char PIN payloads', async () => {
  const subtle = globalThis.crypto.subtle;
  const legacyPin = '7743';
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const encoder = new TextEncoder();

  // Derive key using legacy 4-char PIN directly (matching encryptVaultBundle's PBKDF2-HMAC-SHA256)
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(legacyPin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS_V3, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const plaintext = encoder.encode(JSON.stringify({ sessionString: 'legacy-4char-session' }));
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const toB64 = (u8: Uint8Array) => Buffer.from(u8).toString('base64');

  const legacyPayload: EncryptedPayload = {
    hasPin: true,
    formatVersion: 3,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(new Uint8Array(cipherBuf)),
    savedAt: Date.now(),
  };

  const decrypted = await decryptVaultPayload(legacyPayload, '۷۷۴۳');
  assert.equal(decrypted.sessionString, 'legacy-4char-session');
});

test('decryptVaultPayload rejects wrong PIN with WRONG_PIN and empty PIN with PIN_REQUIRED', async () => {
  const payload = await encryptVaultBundle(
    { sessionString: 'locked-session' },
    '774301',
  );

  await assert.rejects(
    () => decryptVaultPayload(payload, '000001'),
    (err: unknown) => err instanceof VaultError && err.code === 'WRONG_PIN',
  );

  await assert.rejects(
    () => decryptVaultPayload(payload, ''),
    (err: unknown) => err instanceof VaultError && err.code === 'PIN_REQUIRED',
  );
});

test('encryptVaultBundle without PIN decrypts cleanly using device key', async () => {
  const payload = await encryptVaultBundle(
    { sessionString: 'device-locked-session' },
    '',
  );
  assert.equal(payload.hasPin, false);

  const decrypted = await decryptVaultPayload(payload);
  assert.equal(decrypted.sessionString, 'device-locked-session');
});

test('decryptVaultPayload locks out after 5 consecutive incorrect PIN attempts', async () => {
  resetPinLockout();
  const payload = await encryptVaultBundle(
    { sessionString: 'brute-force-target' },
    '998877',
  );

  // 4 failed attempts should yield WRONG_PIN
  for (let i = 0; i < 4; i++) {
    await assert.rejects(
      () => decryptVaultPayload(payload, '112233'),
      (err: unknown) => err instanceof VaultError && err.code === 'WRONG_PIN',
    );
  }

  // 5th failed attempt should trigger lockout
  await assert.rejects(
    () => decryptVaultPayload(payload, '112233'),
    (err: unknown) => err instanceof VaultError && err.code === 'WRONG_PIN',
  );

  // 6th attempt should be blocked with PIN_LOCKED
  await assert.rejects(
    () => decryptVaultPayload(payload, '998877'), // even with correct PIN, must be locked!
    (err: unknown) => err instanceof VaultError && err.code === 'PIN_LOCKED',
  );

  resetPinLockout();
});

test('loadApiCredentials rejects and deletes legacy plaintext apiCreds records', async () => {
  const store = new Map<string, string>();
  const mockLs = {
    get length() {
      return store.size;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(k: string) {
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      store.set(k, v);
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  } as Storage;

  const prevWindow = (globalThis as { window?: unknown }).window;
  const prevLs = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { window: unknown }).window = { localStorage: mockLs };
  (globalThis as { localStorage: unknown }).localStorage = mockLs;

  try {
    // Seed legacy unencrypted apiCreds in fallback storage
    store.set(
      'telescope_vault_fb_api_credentials_v1',
      JSON.stringify({ apiId: 999999, apiHash: 'plaintext-api-hash' }),
    );

    const loaded = await loadApiCredentials();
    assert.equal(loaded, null);
    assert.equal(store.has('telescope_vault_fb_api_credentials_v1'), false);

    // Encrypted saveApiCredentials + loadApiCredentials still works cleanly
    await saveApiCredentials({ apiId: 123456, apiHash: 'abcdef0123456789abcdef0123456789' });
    const roundtrip = await loadApiCredentials();
    assert.deepEqual(roundtrip, { apiId: 123456, apiHash: 'abcdef0123456789abcdef0123456789' });
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = prevWindow;
    }
    if (prevLs === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage: unknown }).localStorage = prevLs;
    }
  }
});

test('per-post stats storage writes O(1) keys, migrates legacy ch:id:stats, and clears cleanly', async () => {
  const stores = new Map<string, Map<string, unknown>>([
    ['vault', new Map()],
    ['snapshots', new Map()],
  ]);

  class MockKeyRange {
    constructor(
      public lower: string,
      public upper: string,
      public lowerOpen: boolean,
      public upperOpen: boolean,
    ) {}
    includes(k: string) {
      const lowOk = this.lowerOpen ? k > this.lower : k >= this.lower;
      const highOk = this.upperOpen ? k < this.upper : k <= this.upper;
      return lowOk && highOk;
    }
    static bound(lower: string, upper: string, lowerOpen = false, upperOpen = false) {
      return new MockKeyRange(lower, upper, lowerOpen, upperOpen);
    }
  }

  function makeReq<T>(fn: () => T) {
    const req: { result?: T; error?: Error; onsuccess?: () => void; onerror?: () => void } = {};
    queueMicrotask(() => {
      try {
        req.result = fn();
        req.onsuccess?.();
      } catch (e) {
        req.error = e instanceof Error ? e : new Error(String(e));
        req.onerror?.();
      }
    });
    return req;
  }

  const mockDb: {
    objectStoreNames: { contains: (name: string) => boolean };
    onversionchange?: () => void;
    onclose?: () => void;
    close: () => void;
    transaction: (storeName: string) => unknown;
  } = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    close: () => {},
    transaction(storeName: string) {
      const map = stores.get(storeName)!;
      const tx: {
        oncomplete?: () => void;
        onerror?: () => void;
        onabort?: () => void;
        objectStore: () => unknown;
      } = {
        objectStore: () => ({
          get: (k: string) => makeReq(() => map.get(k)),
          put: (v: unknown, k: string) => makeReq(() => { map.set(k, v); return k; }),
          delete: (target: string | MockKeyRange) =>
            makeReq(() => {
              if (target instanceof MockKeyRange) {
                for (const k of Array.from(map.keys())) {
                  if (target.includes(k)) map.delete(k);
                }
              } else {
                map.delete(target);
              }
            }),
          clear: () => makeReq(() => { map.clear(); }),
          getAllKeys: (range?: MockKeyRange) =>
            makeReq(() =>
              Array.from(map.keys())
                .sort()
                .filter((k) => (!range ? true : range.includes(k))),
            ),
          getAll: (range?: MockKeyRange) =>
            makeReq(() =>
              Array.from(map.keys())
                .sort()
                .filter((k) => (!range ? true : range.includes(k)))
                .map((k) => map.get(k)),
            ),
        }),
      };
      // Complete transaction after microtasks settle
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };

  const mockIndexedDb = {
    open() {
      const req: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void } = {
        result: mockDb,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };

  const prevIdb = (globalThis as { indexedDB?: unknown }).indexedDB;
  const prevRange = (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange;
  (globalThis as { indexedDB: unknown }).indexedDB = mockIndexedDb;
  (globalThis as { IDBKeyRange: unknown }).IDBKeyRange = MockKeyRange;

  try {
    const snapMap = stores.get('snapshots')!;
    // Seed legacy ch:100:stats and unrelated channel ch:1004:post:msg:1
    snapMap.set('ch:100:stats', {
      'msg:10': {
        postKey: 'msg:10',
        primaryId: 10,
        dailyBreakdown: [{ dateKey: '2026-11-01', views: 5, shares: 1 }],
        publicForwards: [],
        loadedAt: 1000,
      },
    });
    snapMap.set('ch:1004:post:msg:1', {
      postKey: 'msg:1',
      primaryId: 1,
      dailyBreakdown: [],
      publicForwards: [],
      loadedAt: 1000,
    });

    // 1. saveChannelPostStat writes only ch:100:post:msg:20 and stamps normalizedVersion
    await saveChannelPostStat(100, 'msg:20', {
      postKey: 'msg:20',
      primaryId: 20,
      dailyBreakdown: [{ dateKey: '2026-11-02', views: 12, shares: 2 }],
      publicForwards: [],
      loadedAt: 2000,
    });
    assert.ok(snapMap.has('ch:100:post:msg:20'));

    // 2. loadChannelPostStats reads range AND migrates legacy ch:100:stats without picking up ch:1004
    const loaded = await loadChannelPostStats(100);
    assert.equal(Object.keys(loaded).length, 2);
    assert.equal(loaded['msg:10']?.normalizedVersion, undefined); // legacy preserved un-normalized
    assert.equal(loaded['msg:20']?.normalizedVersion, POST_STATS_NORMALIZED_VERSION);
    assert.equal(snapMap.has('ch:100:stats'), false); // migrated & deleted
    assert.ok(snapMap.has('ch:100:post:msg:10'));
    assert.ok(snapMap.has('ch:1004:post:msg:1')); // untouched

    // 3. saveChannelPostStats writes per-post keys in batch
    await saveChannelPostStats(100, {
      'msg:30': {
        postKey: 'msg:30',
        primaryId: 30,
        dailyBreakdown: [],
        publicForwards: [],
        loadedAt: 3000,
      },
    });
    assert.ok(snapMap.has('ch:100:post:msg:30'));

    // 4. clearChannelCache removes ch:100:* including ch:100:post:* while keeping ch:1004
    await clearChannelCache(100);
    assert.equal(snapMap.has('ch:100:post:msg:10'), false);
    assert.equal(snapMap.has('ch:100:post:msg:20'), false);
    assert.equal(snapMap.has('ch:100:post:msg:30'), false);
    assert.ok(snapMap.has('ch:1004:post:msg:1'));

    // 5. wipeAllVaultData clears remaining ch:* keys
    await wipeAllVaultData();
    assert.equal(snapMap.size, 0);
  } finally {
    mockDb.onclose?.();
    if (prevIdb === undefined) {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    } else {
      (globalThis as { indexedDB: unknown }).indexedDB = prevIdb;
    }
    if (prevRange === undefined) {
      delete (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange;
    } else {
      (globalThis as { IDBKeyRange: unknown }).IDBKeyRange = prevRange;
    }
  }
});

test('sanitizeNetworkForUnencryptedStorage strips SOCKS5 password while preserving non-secret fields', () => {
  const sanitized = sanitizeNetworkForUnencryptedStorage({
    mode: 'socks5-bridge',
    socks5: {
      bridgeUrl: 'ws://127.0.0.1:8787',
      host: '127.0.0.1',
      port: 1080,
      username: 'alice',
      password: 'super-secret-password',
    },
    cfRelayUrl: '',
  });
  assert.equal(sanitized.socks5.password, '');
  assert.equal(sanitized.socks5.username, 'alice');
  assert.equal(sanitized.socks5.host, '127.0.0.1');
});
