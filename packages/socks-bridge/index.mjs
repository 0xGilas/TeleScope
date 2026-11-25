#!/usr/bin/env node
/**
 * TeleScope — Local SOCKS5 Bridge (zero telemetry, 127.0.0.1 only)
 * Relays encrypted MTProto WebSocket frames from the browser through a user's SOCKS5 proxy.
 * Hardened against SSRF & unauthorized cross-origin access:
 *   - Requires BRIDGE_TOKEN (auto-generated per run if omitted)
 *   - Restricts upstream targets strictly to official *.web.telegram.org WebSocket endpoints
 *   - Restricts SOCKS5 proxy host to local loopback (unless ALLOWED_SOCKS_HOSTS is explicitly set)
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = Number(process.env.PORT || 8787);
const ALLOW_UNAUTH = process.env.ALLOW_UNAUTH_BRIDGE === '1';
const GENERATED_TOKEN = crypto.randomBytes(16).toString('hex');
const BRIDGE_TOKEN = ALLOW_UNAUTH
  ? (process.env.BRIDGE_TOKEN || '').trim()
  : (process.env.BRIDGE_TOKEN || GENERATED_TOKEN).trim();

const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_SOCKS_HOSTS = new Set(
  (process.env.ALLOWED_SOCKS_HOSTS || '127.0.0.1,localhost,::1,[::1]')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const TELEGRAM_HOST_REGEX = /^(?:[a-zA-Z0-9-]+\.)?web\.telegram\.org$/;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const PING_IDLE_TIMEOUT_MS = 5_000;
const MAX_CONNECTIONS = 64;
const HIGH_WATER_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function normalizeCloseCode(code) {
  if (!Number.isInteger(code)) return 1000;
  if (code === 1004 || code === 1005 || code === 1006 || code === 1015) return 1000;
  if ((code >= 1000 && code <= 1014) || (code >= 3000 && code <= 4999)) return code;
  return 1011;
}

function truncateUtf8(reason, maxBytes = 123) {
  if (!reason) return '';
  const buf = Buffer.from(String(reason), 'utf8');
  if (buf.length <= maxBytes) return buf.toString('utf8');
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
}

function safeCloseWs(ws, code = 1000, reason = '') {
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) return;
  if (ws.readyState === WebSocket.CONNECTING) {
    try {
      ws.terminate();
    } catch {
      // ignore
    }
    return;
  }
  try {
    ws.close(normalizeCloseCode(code), truncateUtf8(reason, 123));
  } catch {
    try {
      ws.terminate();
    } catch {
      // ignore
    }
  }
}

function safeSendJson(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // ignore send on closing socket
  }
}

function createBackpressureRelay(srcWs, dstWs) {
  let paused = false;
  return (data, isBinary) => {
    if (!dstWs || dstWs.readyState !== WebSocket.OPEN) return;
    if (dstWs.bufferedAmount > MAX_BUFFERED_BYTES) {
      safeCloseWs(dstWs, 1011, 'Backpressure limit exceeded');
      safeCloseWs(srcWs, 1011, 'Backpressure limit exceeded');
      return;
    }
    try {
      dstWs.send(data, { binary: isBinary });
    } catch {
      safeCloseWs(dstWs, 1011, 'Relay send failed');
      safeCloseWs(srcWs, 1011, 'Relay send failed');
      return;
    }
    if (!paused && dstWs.bufferedAmount > HIGH_WATER_BYTES && srcWs._socket && dstWs._socket) {
      paused = true;
      srcWs._socket.pause();
      dstWs._socket.once('drain', () => {
        paused = false;
        if (srcWs._socket && !srcWs._socket.destroyed) {
          srcWs._socket.resume();
        }
      });
    }
  };
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (EXTRA_ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    return false;
  } catch {
    return false;
  }
}

function isAuthorizedToken(reqUrl, msgToken) {
  if (!BRIDGE_TOKEN) return true;
  if (typeof msgToken === 'string' && constantTimeEqual(msgToken.trim(), BRIDGE_TOKEN)) return true;
  try {
    const parsed = new URL(reqUrl || '/', `http://${LISTEN_HOST}:${LISTEN_PORT}`);
    const qToken = parsed.searchParams.get('token') || '';
    return constantTimeEqual(qToken, BRIDGE_TOKEN);
  } catch {
    return false;
  }
}

function isAllowedTelegramUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'wss:' &&
      (parsed.port === '' || parsed.port === '443') &&
      !parsed.username &&
      !parsed.password &&
      TELEGRAM_HOST_REGEX.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'telescope-socks-bridge', authRequired: Boolean(BRIDGE_TOKEN) }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({
  server,
  maxPayload: 1024 * 1024, // 1 MiB max frame size
  verifyClient: ({ origin }, cb) => {
    if (!isAllowedOrigin(origin)) {
      cb(false, 403, 'Origin not allowed');
      return;
    }
    cb(true);
  },
});

wss.on('connection', (clientWs, req) => {
  if (wss.clients.size > MAX_CONNECTIONS) {
    safeSendJson(clientWs, { type: 'error', error: 'Too many concurrent connections' });
    safeCloseWs(clientWs, 1013, 'Too many connections');
    return;
  }

  let upstreamWs = null;
  let handshakeCompleted = false;
  let pingIdleTimer = null;
  let relayClientToUpstream = null;

  const closeUpstream = () => {
    if (!upstreamWs) return;
    if (upstreamWs.readyState === WebSocket.CONNECTING) {
      try {
        upstreamWs.terminate();
      } catch {
        // ignore
      }
    } else {
      safeCloseWs(upstreamWs, 1000);
    }
  };

  let handshakeTimer = setTimeout(() => {
    if (!handshakeCompleted) {
      closeUpstream();
      safeSendJson(clientWs, { type: 'error', error: 'Handshake timeout' });
      safeCloseWs(clientWs, 1008, 'Handshake timeout');
    }
  }, HANDSHAKE_TIMEOUT_MS);

  const clearTimers = () => {
    if (handshakeTimer) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
    if (pingIdleTimer) {
      clearTimeout(pingIdleTimer);
      pingIdleTimer = null;
    }
  };

  clientWs.on('message', (data, isBinary) => {
    if (!handshakeCompleted) {
      if (upstreamWs) {
        safeSendJson(clientWs, { type: 'error', error: 'Handshake already in progress' });
        safeCloseWs(clientWs, 1008, 'Duplicate handshake');
        return;
      }

      let msg;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch {
        clearTimers();
        safeSendJson(clientWs, { type: 'error', error: 'Invalid handshake JSON' });
        safeCloseWs(clientWs, 1008, 'Invalid handshake JSON');
        return;
      }

      if (!isAuthorizedToken(req.url, msg?.token)) {
        clearTimers();
        safeSendJson(clientWs, { type: 'error', error: 'Unauthorized bridge token' });
        safeCloseWs(clientWs, 1008, 'Unauthorized');
        return;
      }

      if (msg.type === 'ping') {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        safeSendJson(clientWs, { type: 'pong', ts: Date.now() });
        if (pingIdleTimer) clearTimeout(pingIdleTimer);
        pingIdleTimer = setTimeout(() => {
          safeCloseWs(clientWs, 1000, 'Ping idle timeout');
        }, PING_IDLE_TIMEOUT_MS);
        return;
      }

      if (pingIdleTimer) {
        clearTimeout(pingIdleTimer);
        pingIdleTimer = null;
      }
      if (!handshakeTimer) {
        handshakeTimer = setTimeout(() => {
          if (!handshakeCompleted) {
            closeUpstream();
            safeSendJson(clientWs, { type: 'error', error: 'Handshake timeout' });
            safeCloseWs(clientWs, 1008, 'Handshake timeout');
          }
        }, HANDSHAKE_TIMEOUT_MS);
      }

      if (msg.type !== 'connect' || !isAllowedTelegramUrl(msg.targetUrl)) {
        clearTimers();
        safeSendJson(clientWs, { type: 'error', error: 'Target URL not in *.web.telegram.org allowlist' });
        safeCloseWs(clientWs, 1008, 'Target URL not allowed');
        return;
      }

      const s = msg.socks5 || {};
      const parsedPort = Number(s.port);
      if (
        typeof s.host !== 'string' ||
        !s.host.trim() ||
        !Number.isInteger(parsedPort) ||
        parsedPort < 1 ||
        parsedPort > 65535
      ) {
        clearTimers();
        safeSendJson(clientWs, { type: 'error', error: 'Invalid SOCKS5 host or port (1..65535)' });
        safeCloseWs(clientWs, 1008, 'Invalid SOCKS5 config');
        return;
      }

      const safeHost = s.host.trim().replace(/[^a-zA-Z0-9.:\[\]-]/g, '').toLowerCase();
      if (!safeHost || !ALLOWED_SOCKS_HOSTS.has(safeHost)) {
        clearTimers();
        safeSendJson(clientWs, {
          type: 'error',
          error: `SOCKS5 host "${safeHost || 'empty'}" is not in ALLOWED_SOCKS_HOSTS`,
        });
        safeCloseWs(clientWs, 1008, 'SOCKS5 host not allowed');
        return;
      }

      const auth =
        s.username && s.password
          ? `${encodeURIComponent(s.username)}:${encodeURIComponent(s.password)}@`
          : '';
      const proxyUri = `socks5h://${auth}${safeHost}:${parsedPort}`;
      const agent = new SocksProxyAgent(proxyUri);

      upstreamWs = new WebSocket(msg.targetUrl, 'binary', {
        agent,
        maxPayload: 1024 * 1024,
        handshakeTimeout: 15_000,
      });
      upstreamWs.binaryType = 'arraybuffer';

      const relayUpstreamToClient = createBackpressureRelay(upstreamWs, clientWs);
      relayClientToUpstream = createBackpressureRelay(clientWs, upstreamWs);

      upstreamWs.on('open', () => {
        handshakeCompleted = true;
        clearTimers();
        safeSendJson(clientWs, { type: 'ready' });
      });

      upstreamWs.on('message', (upData, upIsBinary) => {
        relayUpstreamToClient(upData, upIsBinary);
      });

      upstreamWs.on('error', (err) => {
        clearTimers();
        if (!handshakeCompleted) {
          safeSendJson(clientWs, { type: 'error', error: err.message });
        }
        safeCloseWs(clientWs, 1011, err.message);
      });

      upstreamWs.on('close', (code, reason) => {
        clearTimers();
        safeCloseWs(clientWs, code, reason ? reason.toString('utf8') : '');
      });
      return;
    }

    if (relayClientToUpstream) {
      relayClientToUpstream(data, isBinary);
    }
  });

  clientWs.on('error', () => {
    clearTimers();
    closeUpstream();
  });

  clientWs.on('close', () => {
    clearTimers();
    closeUpstream();
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[telescope-socks-bridge] Listening on ws://${LISTEN_HOST}:${LISTEN_PORT}`);
  if (BRIDGE_TOKEN) {
    console.log(`[telescope-socks-bridge] Bridge Token: ${BRIDGE_TOKEN}`);
  } else {
    console.log('[telescope-socks-bridge] WARNING: Running without BRIDGE_TOKEN (ALLOW_UNAUTH_BRIDGE=1)');
  }
  console.log(`[telescope-socks-bridge] Allowed SOCKS hosts: ${Array.from(ALLOWED_SOCKS_HOSTS).join(', ')}`);
});
