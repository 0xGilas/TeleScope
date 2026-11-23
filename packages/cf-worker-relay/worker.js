/**
 * TeleScope — Personal Cloudflare Worker WebSocket Relay
 * Deploy to your own Cloudflare account (`wrangler deploy`) to relay encrypted MTProto
 * WebSocket traffic to official *.web.telegram.org endpoints without installing local software.
 *
 * Security (Fail-Closed by default):
 *   Set at least one of RELAY_SECRET or ALLOWED_ORIGINS via `wrangler secret put` / `wrangler.toml`:
 *   - RELAY_SECRET: shared token expected via `?token=<secret>` or `x-relay-token`
 *   - ALLOWED_ORIGINS: comma-separated list of allowed browser Origins (e.g. "https://you.github.io")
 *   - ALLOW_PUBLIC_RELAY: set to "true" ONLY if you intentionally want an unauthenticated public relay
 */
const TELEGRAM_HOST_REGEX = /^(?:[a-zA-Z0-9-]+\.)?web\.telegram\.org$/;

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
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

    if (!allowedOriginsRaw && !relaySecret && !allowPublic) {
      return new Response(
        'Relay misconfigured: configure RELAY_SECRET and/or ALLOWED_ORIGINS before using.',
        { status: 403 },
      );
    }

    if (allowedOriginsRaw.length > 0) {
      const origin = request.headers.get('Origin') || '';
      const allowlist = allowedOriginsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!origin || !allowlist.includes(origin)) {
        return new Response('Origin not allowed', { status: 403 });
      }
    }

    const url = new URL(request.url);
    if (relaySecret.length > 0) {
      const token = url.searchParams.get('token') || request.headers.get('x-relay-token') || '';
      if (!constantTimeEqual(token, relaySecret)) {
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

    if (targetUrl.protocol !== 'wss:' || !TELEGRAM_HOST_REGEX.test(targetUrl.hostname)) {
      return new Response('Target hostname not allowed', { status: 403 });
    }

    // Clone headers, strip identifying client info & auth tokens for privacy, and rewrite Host
    const headers = new Headers(request.headers);
    headers.delete('cf-connecting-ip');
    headers.delete('x-forwarded-for');
    headers.delete('x-real-ip');
    headers.delete('x-relay-token');
    headers.set('Host', targetUrl.hostname);

    const httpTarget = targetUrl.toString().replace(/^wss:/, 'https:');
    return fetch(httpTarget, {
      headers,
    });
  },
};
