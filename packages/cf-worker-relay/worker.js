/**
 * TeleScope — Personal Cloudflare Worker WebSocket Relay
 * Deploy to your own Cloudflare account (`wrangler deploy`) to relay encrypted MTProto
 * WebSocket traffic to official *.web.telegram.org endpoints without installing local software.
 *
 * Security (Fail-Closed by default):
 *   Set RELAY_SECRET via `wrangler secret put` / `wrangler.toml`:
 *   - RELAY_SECRET: shared token expected via `x-relay-token` header or `Sec-WebSocket-Protocol` (`tg-auth.<hex>`)
 *   - ALLOWED_ORIGINS: optional comma-separated defense-in-depth allowlist of allowed browser Origins (e.g. "https://you.github.io")
 *   - ALLOW_QUERY_TOKEN: set to "true" ONLY if you need backwards-compatible `?token=` query parameter auth
 *   - ALLOW_PUBLIC_RELAY: set to "true" ONLY if you intentionally want an unauthenticated public relay
 */
const TELEGRAM_HOST_REGEX = /^(?:[a-zA-Z0-9-]+\.)?web\.telegram\.org$/;
const ALLOWLISTED_WS_HEADERS = [
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
];
const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

let cachedAllowedOriginsRaw = null;
let cachedAllowedOrigins = [];

function getAllowedOrigins(raw) {
  if (raw === cachedAllowedOriginsRaw) return cachedAllowedOrigins;
  cachedAllowedOriginsRaw = raw;
  cachedAllowedOrigins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cachedAllowedOrigins;
}

function decodeHexToken(proto) {
  const hex = proto.slice('tg-auth.'.length);
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return '';
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return '';
  }
}

async function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [bufA, bufB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(bufA);
  const viewB = new Uint8Array(bufB);
  let diff = 0;
  for (let i = 0; i < viewA.length; i += 1) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

export default {
  async fetch(request, env = {}) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('TeleScope Relay Ready. Connect via WebSocket with ?target=wss://...', {
        status: 200,
      });
    }

    const allowedOriginsRaw = typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS.trim() : '';
    const relaySecret = typeof env.RELAY_SECRET === 'string' ? env.RELAY_SECRET.trim() : '';
    const allowPublic = env.ALLOW_PUBLIC_RELAY === 'true';
    const allowQueryToken = env.ALLOW_QUERY_TOKEN === 'true';

    if (!relaySecret && !allowPublic) {
      return new Response(
        'Relay misconfigured: configure RELAY_SECRET before using (or set ALLOW_PUBLIC_RELAY=true explicitly).',
        { status: 403 },
      );
    }

    if (allowedOriginsRaw.length > 0) {
      const origin = request.headers.get('Origin') || '';
      const allowlist = getAllowedOrigins(allowedOriginsRaw);
      if (!origin || !allowlist.includes(origin)) {
        return new Response('Origin not allowed', { status: 403 });
      }
    }

    const rawProtocols = request.headers.get('Sec-WebSocket-Protocol') || '';
    const protocolParts = rawProtocols
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const authProto = protocolParts.find((p) => p.startsWith('tg-auth.'));
    const forwardProtocols = protocolParts.filter((p) => !p.startsWith('tg-auth.'));

    const url = new URL(request.url);
    if (relaySecret.length > 0) {
      const headerToken = request.headers.get('x-relay-token') || '';
      const protoToken = authProto ? decodeHexToken(authProto) : '';
      const queryToken = allowQueryToken ? url.searchParams.get('token') || '' : '';
      const token = headerToken || protoToken || queryToken;
      if (!(await constantTimeEqual(token, relaySecret))) {
        return new Response('Unauthorized relay token', { status: 401 });
      }
    }

    const targetRaw = url.searchParams.get('target');
    if (!targetRaw) {
      return new Response('Missing target parameter', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetRaw);
    } catch {
      return new Response('Invalid target URL', { status: 400 });
    }

    if (
      targetUrl.protocol !== 'wss:' ||
      (targetUrl.port !== '' && targetUrl.port !== '443') ||
      targetUrl.username ||
      targetUrl.password ||
      !TELEGRAM_HOST_REGEX.test(targetUrl.hostname)
    ) {
      return new Response('Target URL not allowed', { status: 403 });
    }

    // Construct a fresh allowlisted Headers object to avoid leaking client headers or auth tokens
    const headers = new Headers();
    for (const name of ALLOWLISTED_WS_HEADERS) {
      const val = request.headers.get(name);
      if (val) headers.set(name, val);
    }
    headers.set('Host', targetUrl.hostname);
    if (forwardProtocols.length > 0) {
      headers.set('Sec-WebSocket-Protocol', forwardProtocols.join(', '));
    }

    const httpTarget = targetUrl.toString().replace(/^wss:/, 'https:');
    return fetch(httpTarget, {
      headers,
    });
  },
};
