import type {
  ApiCredentials,
  BroadcastOverviewStats,
  ChannelSummary,
  NetworkConfig,
  PostDetailedStats,
  PostMediaPreview,
  RawChannelMessage,
  TelegramUserSummary,
} from '../types/analytics';
import type {
  AttributionScanCandidate,
  AttributionScanItemResult,
  WorkerCommand,
  WorkerEvent,
} from '../worker/mtproto.worker';

export interface BridgeListeners {
  onQrUpdated?: (url: string, expiresAt: number) => void;
  onQrScanned?: () => void;
  onQrPasswordNeeded?: () => void;
  onAuthorized?: (user: TelegramUserSummary) => void;
  onScanProgress?: (channelId: number, scannedCount: number) => void;
  onAttributionProgress?: (channelId: number, completed: number, total: number) => void;
  onChannelAvatarsUpdated?: (avatars: Record<number, string>) => void;
  onLiveForwardsUpdate?: (channelId: number, msgId: number, forwards: number) => void;
  onAttributionFloodWait?: (channelId: number, waitSec: number) => void;
}

class TelegramWorkerBridge {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private listeners: BridgeListeners = {};
  private reqCounter = 0;
  private lastAttributionDispatch = 0;
  private pendingAttributionTimer: ReturnType<typeof setTimeout> | null = null;

  setListeners(listeners: BridgeListeners) {
    this.listeners = listeners;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../worker/mtproto.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
      const msg = event.data;
      if (msg.type === 'rpc_ok') {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.resolve(msg.payload);
        }
        return;
      }
      if (msg.type === 'rpc_err') {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.reject(new Error(msg.error));
        }
        return;
      }
      if (msg.type === 'qr_updated') this.listeners.onQrUpdated?.(msg.url, msg.expiresAt);
      if (msg.type === 'qr_scanned') this.listeners.onQrScanned?.();
      if (msg.type === 'qr_password_needed') this.listeners.onQrPasswordNeeded?.();
      if (msg.type === 'authorized') this.listeners.onAuthorized?.(msg.user);
      if (msg.type === 'scan_progress') {
        this.listeners.onScanProgress?.(msg.channelId, msg.scannedCount);
      }
      if (msg.type === 'attribution_progress') {
        const isFinal = msg.completed >= msg.total;
        if (isFinal) {
          if (this.pendingAttributionTimer) {
            clearTimeout(this.pendingAttributionTimer);
            this.pendingAttributionTimer = null;
          }
          this.lastAttributionDispatch = Date.now();
          this.listeners.onAttributionProgress?.(msg.channelId, msg.completed, msg.total);
        } else {
          const now = Date.now();
          if (now - this.lastAttributionDispatch >= 120) {
            if (this.pendingAttributionTimer) {
              clearTimeout(this.pendingAttributionTimer);
              this.pendingAttributionTimer = null;
            }
            this.lastAttributionDispatch = now;
            this.listeners.onAttributionProgress?.(msg.channelId, msg.completed, msg.total);
          } else if (!this.pendingAttributionTimer) {
            const chId = msg.channelId;
            const comp = msg.completed;
            const tot = msg.total;
            this.pendingAttributionTimer = setTimeout(() => {
              this.pendingAttributionTimer = null;
              this.lastAttributionDispatch = Date.now();
              this.listeners.onAttributionProgress?.(chId, comp, tot);
            }, 120);
          }
        }
      }
      if (msg.type === 'channel_avatars_updated') {
        this.listeners.onChannelAvatarsUpdated?.(msg.avatars);
      }
      if (msg.type === 'live_forwards_update') {
        this.listeners.onLiveForwardsUpdate?.(msg.channelId, msg.msgId, msg.forwards);
      }
      if (msg.type === 'attribution_flood_wait') {
        this.listeners.onAttributionFloodWait?.(msg.channelId, msg.waitSec);
      }
    };

    worker.onerror = (err) => {
      for (const entry of this.pending.values()) {
        entry.reject(new Error(err.message || 'MTProto worker error'));
      }
      this.pending.clear();
    };

    this.worker = worker;
    return worker;
  }

  private invoke<T>(cmd: WorkerCommand extends infer U ? (U extends WorkerCommand ? Omit<U, 'id'> : never) : never): Promise<T> {
    const worker = this.ensureWorker();
    const id = `req_${++this.reqCounter}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
      });
      worker.postMessage({ ...cmd, id });
    });
  }

  init(apiCreds: ApiCredentials, network: NetworkConfig, sessionString?: string) {
    return this.invoke<{ authorized: boolean; user?: TelegramUserSummary; reason?: string }>({
      type: 'init',
      apiCreds,
      network,
      sessionString,
    });
  }

  startQr() {
    return this.invoke<TelegramUserSummary>({ type: 'start_qr' });
  }

  abortQr() {
    return this.invoke<{ aborted: boolean }>({ type: 'abort_qr' });
  }

  sendCode(phone: string) {
    return this.invoke<
      | { alreadyAuthorized: true; user: TelegramUserSummary }
      | { alreadyAuthorized: false; phoneCodeHash: string; timeout?: number }
    >({ type: 'send_code', phone });
  }

  signIn(phone: string, phoneCodeHash: string, code: string) {
    return this.invoke<
      { status: 'authorized'; user: TelegramUserSummary } | { status: 'password_needed' }
    >({ type: 'sign_in', phone, phoneCodeHash, code });
  }

  checkPassword(password: string) {
    return this.invoke<{ status: string; user?: TelegramUserSummary }>({
      type: 'check_password',
      password,
    });
  }

  exportSession() {
    return this.invoke<{ sessionString: string }>({ type: 'export_session' });
  }

  private rejectAllPending(reason: string) {
    if (this.pending.size === 0) return;
    const err = new Error(reason);
    for (const entry of this.pending.values()) {
      entry.reject(err);
    }
    this.pending.clear();
  }

  terminateOnly() {
    if (this.pendingAttributionTimer) {
      clearTimeout(this.pendingAttributionTimer);
      this.pendingAttributionTimer = null;
    }
    this.rejectAllPending('Telegram worker terminated');
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  async logoutAndTerminate() {
    if (this.pendingAttributionTimer) {
      clearTimeout(this.pendingAttributionTimer);
      this.pendingAttributionTimer = null;
    }
    if (!this.worker) return;
    try {
      await this.invoke<{ loggedOut: boolean }>({ type: 'logout' });
    } finally {
      this.rejectAllPending('Telegram worker terminated');
      this.worker.terminate();
      this.worker = null;
    }
  }

  getChannels() {
    return this.invoke<ChannelSummary[]>({ type: 'get_channels' });
  }

  fetchChannelAnalytics(channelId: number, maxMessages = 400) {
    return this.invoke<{
      channel: ChannelSummary;
      overview: BroadcastOverviewStats;
      rawMessages: RawChannelMessage[];
    }>({ type: 'fetch_channel_analytics', channelId, maxMessages });
  }

  fetchPostDetails(
    channelId: number,
    postId: number,
    statsDc?: number,
    postKey?: string,
    postDate?: number,
  ) {
    return this.invoke<PostDetailedStats>({
      type: 'fetch_post_details',
      channelId,
      postId,
      postKey,
      statsDc,
      postDate,
    });
  }

  fetchPostMediaPreview(channelId: number, postKey: string, messageIds: number[]) {
    return this.invoke<PostMediaPreview>({
      type: 'fetch_post_media_preview',
      channelId,
      postKey,
      messageIds,
    });
  }

  scanDateAttribution(
    channelId: number,
    posts: AttributionScanCandidate[],
    statsDc?: number,
    maxPosts = 40,
  ) {
    return this.invoke<AttributionScanItemResult[]>({
      type: 'scan_date_attribution',
      channelId,
      posts,
      statsDc,
      maxPosts,
    });
  }

  abortAttribution() {
    if (!this.worker) return Promise.resolve({ aborted: false });
    return this.invoke<{ aborted: boolean }>({ type: 'abort_attribution' });
  }

  abortChannelSync() {
    if (!this.worker) return Promise.resolve({ aborted: false });
    return this.invoke<{ aborted: boolean }>({ type: 'abort_channel_sync' });
  }
}

export const telegramBridge = new TelegramWorkerBridge();

/**
 * Tests local SOCKS5 bridge reachability over ws://127.0.0.1:8787 (without touching Telegram yet)
 */
export function testBridgeReachability(bridgeUrl: string, bridgeToken?: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, message: 'Timeout: local SOCKS5 bridge did not respond on ' + bridgeUrl });
      }
    }, 3500);

    try {
      const ws = new WebSocket(bridgeUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'ping', token: bridgeToken?.trim() || undefined }));
      };
      ws.onmessage = (ev) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve({ ok: true, message: `Bridge reachable (${String(ev.data)})` });
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, message: `Cannot connect to ${bridgeUrl}. Make sure socks-bridge is running.` });
      };
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, message: err instanceof Error ? err.message : 'WebSocket error' });
      }
    }
  });
}
