import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Camera, Menu, RefreshCw } from 'lucide-react';
import type {
  ApiCredentials,
  AuthStep,
  ChannelAnalyticsBundle,
  ChannelSnapshot,
  ChannelSummary,
  DailyDeltaRecord,
  LanguageCode,
  NetworkConfig,
  ParsedStatsGraph,
  PostMediaPreview,
  PostRecord,
  PostDetailedStats,
  SessionPersistenceMode,
  TimezoneMode,
} from './types/analytics';
import { getTranslations } from './i18n/translations';
import {
  buildSnapshotFromPosts,
  computeEvergreenRatio,
  computeSnapshotDeltas,
  extractDailyActivityFromGraph,
  formatDateKey,
  groupAlbumPosts,
} from './utils/analyticsMath';
import {
  clearSavedSession,
  getSavedSessionMeta,
  loadApiCredentials,
  loadChannelSnapshotHistory,
  loadEncryptedSessionBundle,
  loadNetworkConfig,
  sanitizeNetworkForUnencryptedStorage,
  saveApiCredentials,
  saveChannelMetaHistory,
  saveChannelPostStats,
  saveChannelSnapshotHistory,
  saveEncryptedSessionBundle,
  saveNetworkConfig,
  VaultError,
  wipeAllVaultData,
} from './utils/cryptoVault';
import { telegramBridge } from './services/telegramBridge';
import { AuthScreen } from './components/auth/AuthScreen';
import { Sidebar } from './components/layout/Sidebar';
import { OverviewTab } from './components/dashboard/OverviewTab';
import { ChannelAvatar } from './components/common/ChannelAvatar';

const NetworkModal = lazy(() =>
  import('./components/auth/NetworkModal').then((m) => ({ default: m.NetworkModal })),
);
const ShareDetectiveTab = lazy(() =>
  import('./components/dashboard/ShareDetectiveTab').then((m) => ({ default: m.ShareDetectiveTab })),
);
const AudienceTab = lazy(() =>
  import('./components/dashboard/AudienceTab').then((m) => ({ default: m.AudienceTab })),
);
const PostDetailDrawer = lazy(() =>
  import('./components/inspector/PostDetailDrawer').then((m) => ({ default: m.PostDetailDrawer })),
);
const SnapshotModal = lazy(() =>
  import('./components/dashboard/SnapshotModal').then((m) => ({ default: m.SnapshotModal })),
);

const DEFAULT_NETWORK: NetworkConfig = {
  mode: 'direct',
  socks5: {
    bridgeUrl: 'ws://127.0.0.1:8787',
    host: '127.0.0.1',
    port: 1080,
    username: '',
    password: '',
    bridgeToken: '',
  },
  cfRelayUrl: '',
  cfRelayToken: '',
};

const ENV_API_ID = Number(import.meta.env?.VITE_TELEGRAM_API_ID) || 0;
const ENV_API_HASH = String(import.meta.env?.VITE_TELEGRAM_API_HASH || '').trim();

const DEFAULT_API_CREDS: ApiCredentials =
  ENV_API_ID > 0 && ENV_API_HASH.length >= 16
    ? { apiId: ENV_API_ID, apiHash: ENV_API_HASH }
    : { apiId: 0, apiHash: '' };

type DashboardTab = 'overview' | 'detective' | 'audience';

function mergeDailyDeltas(
  existing: DailyDeltaRecord[],
  incoming: DailyDeltaRecord[],
): DailyDeltaRecord[] {
  if (incoming.length === 0) return existing.slice(-2000);
  const byKey = new Map<string, DailyDeltaRecord>();
  for (const item of existing) {
    const k = `${item.dateKey}:${item.postKey}`;
    const prev = byKey.get(k);
    if (prev) {
      byKey.set(k, {
        ...prev,
        deltaShares: prev.deltaShares + item.deltaShares,
        deltaViews: prev.deltaViews + item.deltaViews,
      });
    } else {
      byKey.set(k, { ...item });
    }
  }
  for (const item of incoming) {
    const k = `${item.dateKey}:${item.postKey}`;
    const prev = byKey.get(k);
    if (prev) {
      byKey.set(k, {
        ...prev,
        deltaShares: prev.deltaShares + item.deltaShares,
        deltaViews: prev.deltaViews + item.deltaViews,
      });
    } else {
      byKey.set(k, { ...item });
    }
  }
  return Array.from(byKey.values()).slice(-2000);
}

function isValidApiCreds(creds?: ApiCredentials | null): creds is ApiCredentials {
  return Boolean(
    creds &&
      creds.apiId > 0 &&
      creds.apiId !== 2496 &&
      creds.apiHash &&
      creds.apiHash.trim().length >= 16,
  );
}

function pickDefaultDateKey(graph?: ParsedStatsGraph): string | null {
  if (!graph || graph.timestamps.length === 0) return null;
  const shareSeries =
    graph.series.find((s) => /share|forward/i.test(s.label) || s.key === 'y1') ?? graph.series[1];
  if (!shareSeries) {
    return formatDateKey(graph.timestamps[graph.timestamps.length - 1]);
  }
  let bestIdx = graph.timestamps.length - 1;
  let bestVal = -1;
  for (let i = 0; i < graph.timestamps.length; i += 1) {
    const val = shareSeries.values[i] ?? 0;
    if (val >= bestVal) {
      bestVal = val;
      bestIdx = i;
    }
  }
  return formatDateKey(graph.timestamps[bestIdx]);
}

export function App() {
  const [lang, setLang] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem('telescope_lang_v1');
      if (saved === 'en' || saved === 'fa') return saved;
    } catch {
      // ignore
    }
    return 'fa';
  });
  const [timezoneMode, setTimezoneMode] = useState<TimezoneMode>(() => {
    try {
      const saved = localStorage.getItem('telescope_tz_v1');
      if (saved === 'iran' || saved === 'local' || saved === 'utc') return saved;
    } catch {
      // ignore
    }
    return 'iran';
  });
  const [scanDepth, setScanDepth] = useState<number>(400);
  const t = getTranslations(lang);

  // Network & API config
  const [network, setNetwork] = useState<NetworkConfig>(DEFAULT_NETWORK);
  const [networkModalOpen, setNetworkModalOpen] = useState(false);
  const [apiCreds, setApiCreds] = useState<ApiCredentials>(DEFAULT_API_CREDS);
  const [forceShowApiBox, setForceShowApiBox] = useState(false);

  // Persistence consent (Default OFF = Ephemeral MemoryStorage!)
  const [persistenceMode, setPersistenceMode] = useState<SessionPersistenceMode>('ephemeral');
  const [vaultPin, setVaultPin] = useState('');
  const [savedSessionMeta, setSavedSessionMeta] = useState<{ exists: boolean; hasPin: boolean }>({
    exists: false,
    hasPin: false,
  });

  // Live refs prevent stale closures during async MTProto QR/2FA authorization callbacks
  const persistenceRef = useRef<{ mode: SessionPersistenceMode; pin: string }>({
    mode: persistenceMode,
    pin: vaultPin,
  });
  const apiCredsRef = useRef<ApiCredentials>(apiCreds);
  const networkRef = useRef<NetworkConfig>(network);

  useEffect(() => {
    persistenceRef.current = { mode: persistenceMode, pin: vaultPin };
  }, [persistenceMode, vaultPin]);

  useEffect(() => {
    apiCredsRef.current = apiCreds;
  }, [apiCreds]);

  useEffect(() => {
    networkRef.current = network;
  }, [network]);

  // Auth flow state
  const [authStep, setAuthStep] = useState<AuthStep>('idle');
  const [authError, setAuthError] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [phoneState, setPhoneState] = useState<{ phone: string; phoneCodeHash: string }>({
    phone: '',
    phoneCodeHash: '',
  });

  // App workspace state
  const [isSampleMode, setIsSampleMode] = useState<boolean>(false);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [bundlesByChannel, setBundlesByChannel] = useState<Record<number, ChannelAnalyticsBundle>>({});
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedPostKey, setSelectedPostKey] = useState<string | null>(null);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [syncingChannel, setSyncingChannel] = useState(false);
  const [scanProgressCount, setScanProgressCount] = useState(0);
  const [scanningAttribution, setScanningAttribution] = useState(false);
  const [attributionProgress, setAttributionProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [loadingPostDetails, setLoadingPostDetails] = useState(false);
  const [postDetailsError, setPostDetailsError] = useState<string | null>(null);
  const [mediaPreviewsByPost, setMediaPreviewsByPost] = useState<Record<string, PostMediaPreview>>({});
  const mediaPreviewsRef = useRef<Record<string, PostMediaPreview>>({});
  mediaPreviewsRef.current = mediaPreviewsByPost;
  const [loadingMediaPreview, setLoadingMediaPreview] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [floodWaitSec, setFloodWaitSec] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  // Sync HTML dir/lang attributes
  useEffect(() => {
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('telescope_lang_v1', lang);
    } catch {
      // ignore
    }
  }, [lang]);

  useEffect(() => {
    try {
      localStorage.setItem('telescope_tz_v1', timezoneMode);
    } catch {
      // ignore
    }
  }, [timezoneMode]);

  // Escape key closes modals/drawers cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPostKey(null);
        setSnapshotModalOpen(false);
        setNetworkModalOpen(false);
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Load saved non-sensitive settings & check if encrypted session exists
  useEffect(() => {
    loadNetworkConfig().then((cfg) => {
      if (cfg) {
        setNetwork(cfg);
        networkRef.current = cfg;
      }
    });
    loadApiCredentials().then((creds) => {
      if (creds && isValidApiCreds(creds)) {
        setApiCreds(creds);
        apiCredsRef.current = creds;
      }
    });
    getSavedSessionMeta().then((meta) => {
      setSavedSessionMeta({ exists: meta.exists, hasPin: meta.hasPin });
    });
  }, []);

  const enterSampleMode = useCallback(async () => {
    const { getSampleDataset } = await import('./data/sampleChannelData');
    const sample = getSampleDataset();
    const firstChannelId = sample.channels[0].id;
    const firstBundle = sample.bundles[firstChannelId];
    setIsSampleMode(true);
    setChannels(sample.channels);
    setBundlesByChannel(sample.bundles);
    setActiveChannelId(firstChannelId);
    setSelectedDateKey(pickDefaultDateKey(firstBundle?.overview.interactionsGraph));
    setActiveTab('overview');
    setAuthStep('authorized');
    setAuthError(null);
  }, []);

  // Support ?autostart=1 for automated UI testing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      enterSampleMode();
    }
  }, [enterSampleMode]);

  const persistSessionIfConsented = useCallback(async () => {
    const current = persistenceRef.current;
    if (current.mode !== 'vault') return;
    try {
      const { sessionString } = await telegramBridge.exportSession();
      const meta = await saveEncryptedSessionBundle(
        {
          sessionString,
          apiCreds: apiCredsRef.current,
          network: networkRef.current,
        },
        current.pin,
      );
      setSavedSessionMeta({ exists: true, hasPin: meta.hasPin });
    } catch (err) {
      setLiveError(
        err instanceof Error
          ? `Session vault save warning: ${err.message}`
          : 'Failed to encrypt session to local browser vault.',
      );
    }
  }, []);

  const loadLiveChannelBundle = useCallback(async (channelId: number, maxMessages = 400) => {
    setSyncingChannel(true);
    setScanProgressCount(0);
    setLiveError(null);
    try {
      const res = await telegramBridge.fetchChannelAnalytics(channelId, maxMessages);
      const recentSet = new Set(res.overview.recentPostIds);
      const grouped = groupAlbumPosts(res.rawMessages, recentSet);

      const history = await loadChannelSnapshotHistory(channelId);
      const prevSnapshot = history?.latestSnapshot ?? null;
      const rawCachedPostStats = history?.postStatsByPost ?? {};
      const cachedPostStats: Record<string, PostDetailedStats> = {};
      for (const [key, detailed] of Object.entries(rawCachedPostStats)) {
        const post = grouped.find((p) => p.key === key);
        if (post && detailed.viewsGraph) {
          cachedPostStats[key] = {
            ...detailed,
            dailyBreakdown: extractDailyActivityFromGraph(detailed.viewsGraph, post.date),
          };
        } else {
          cachedPostStats[key] = detailed;
        }
      }
      const postsWithDeltas = computeSnapshotDeltas(grouped, prevSnapshot).map((p) => {
        const cached = cachedPostStats[p.key];
        if (!cached) return p;
        const pub = Math.min(p.forwards, cached.publicSharesTotal ?? cached.publicForwards.length);
        return {
          ...p,
          publicSharesCount: pub,
          privateSharesCount: Math.max(0, p.forwards - pub),
          evergreenShareRatio: computeEvergreenRatio(p.date, cached.dailyBreakdown),
        };
      });

      const todayKey = formatDateKey(Date.now());
      const incomingDeltas: DailyDeltaRecord[] = [];
      if (prevSnapshot) {
        for (const post of postsWithDeltas) {
          if (post.deltaShares > 0) {
            incomingDeltas.push({
              dateKey: todayKey,
              postKey: post.key,
              primaryId: post.primaryId,
              deltaShares: post.deltaShares,
              deltaViews: post.deltaViews,
            });
          }
        }
      }
      const newDailyDeltas = mergeDailyDeltas(history?.dailyDeltas ?? [], incomingDeltas);

      const nextSnapshot = buildSnapshotFromPosts(
        res.channel.id,
        res.channel.membersCount,
        postsWithDeltas,
      );
      await saveChannelSnapshotHistory(channelId, {
        latestSnapshot: nextSnapshot,
        dailyDeltas: newDailyDeltas,
        postStatsByPost: cachedPostStats,
      });

      const publicForwardsByPost: ChannelAnalyticsBundle['publicForwardsByPost'] = {};
      for (const [k, v] of Object.entries(cachedPostStats)) {
        if (v.publicForwards.length > 0) {
          publicForwardsByPost[k] = v.publicForwards;
        }
      }

      const bundle: ChannelAnalyticsBundle = {
        channel: res.channel,
        overview: res.overview,
        posts: postsWithDeltas,
        dailyDeltas: newDailyDeltas,
        publicForwardsByPost,
        postStatsByPost: cachedPostStats,
        lastSnapshotAt: prevSnapshot?.capturedAt ?? nextSnapshot.capturedAt,
        scanStatus: {
          scannedCount: res.rawMessages.length,
          attributedPostsCount: Object.keys(cachedPostStats).length,
          isComplete: Object.keys(cachedPostStats).length >= postsWithDeltas.length,
        },
      };

      setBundlesByChannel((prev) => ({ ...prev, [channelId]: bundle }));
      setSelectedDateKey(pickDefaultDateKey(res.overview.interactionsGraph));
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Failed to sync channel');
    } finally {
      setSyncingChannel(false);
    }
  }, []);

  const handleAuthorized = useCallback(
    async (options?: { skipPersist?: boolean }) => {
      setAuthStep('authorized');
      setAuthError(null);
      setLiveError(null);
      if (!options?.skipPersist) {
        await persistSessionIfConsented();
      }
      try {
        const chList = await telegramBridge.getChannels();
        setChannels(chList);
        if (chList.length > 0) {
          setActiveChannelId(chList[0].id);
          await loadLiveChannelBundle(chList[0].id, scanDepth);
        }
      } catch (err) {
        setLiveError(err instanceof Error ? err.message : 'Failed to load channels');
      }
    },
    [persistSessionIfConsented, loadLiveChannelBundle],
  );

  // Wire worker event listeners
  useEffect(() => {
    telegramBridge.setListeners({
      onQrUpdated: (url, expiresAt) => {
        setQrUrl(url);
        setQrExpiresAt(expiresAt);
        setAuthStep('qr_ready');
      },
      onQrScanned: () => {
        setAuthStep('qr_scanned');
      },
      onQrPasswordNeeded: () => {
        setAuthStep('password_needed');
      },
      onAuthorized: () => {
        handleAuthorized();
      },
      onScanProgress: (_chId, count) => {
        setScanProgressCount(count);
      },
      onAttributionProgress: (_chId, completed, total) => {
        setAttributionProgress({ completed, total });
      },
      onAttributionFloodWait: (_chId, waitSec) => {
        setFloodWaitSec(waitSec);
      },
      onChannelAvatarsUpdated: (avatars) => {
        setChannels((prev) =>
          prev.map((ch) => (avatars[ch.id] ? { ...ch, avatarUrl: avatars[ch.id] } : ch)),
        );
        setBundlesByChannel((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [idStr, url] of Object.entries(avatars)) {
            const id = Number(idStr);
            const cur = next[id];
            if (cur && cur.channel.avatarUrl !== url) {
              changed = true;
              next[id] = {
                ...cur,
                channel: { ...cur.channel, avatarUrl: url },
              };
            }
          }
          return changed ? next : prev;
        });
      },
      onLiveForwardsUpdate: (channelId, msgId, forwards) => {
        setBundlesByChannel((prev) => {
          const current = prev[channelId];
          if (!current) return prev;
          const target = current.posts.find((p) => p.messageIds.includes(msgId));
          if (!target || forwards <= target.forwards) return prev;

          const todayKey = formatDateKey(Date.now());
          const diff = forwards - target.forwards;
          const updatedPosts = current.posts.map((p) => {
            if (p.key !== target.key) return p;
            return {
              ...p,
              forwards,
              privateSharesCount: Math.max(0, forwards - p.publicSharesCount),
              deltaShares: p.deltaShares + diff,
            };
          });
          const updatedDeltas = mergeDailyDeltas(current.dailyDeltas, [
            {
              dateKey: todayKey,
              postKey: target.key,
              primaryId: target.primaryId,
              deltaShares: diff,
              deltaViews: 0,
            },
          ]);

          return {
            ...prev,
            [channelId]: {
              ...current,
              posts: updatedPosts,
              dailyDeltas: updatedDeltas,
            },
          };
        });
      },
    });
  }, [handleAuthorized]);

  const validateApiCreds = (credsToCheck: ApiCredentials = apiCredsRef.current): ApiCredentials | null => {
    const cleanId = Number(credsToCheck?.apiId) || 0;
    const cleanHash = String(credsToCheck?.apiHash || '').trim();
    const effective: ApiCredentials = { apiId: cleanId, apiHash: cleanHash };
    if (!isValidApiCreds(effective)) {
      setForceShowApiBox(true);
      setAuthError(
        lang === 'fa'
          ? 'برای اتصال به تلگرام، وارد کردن API ID و API Hash معتبر از my.telegram.org الزامی است.'
          : 'Please enter your valid Telegram API ID and API Hash from my.telegram.org.',
      );
      return null;
    }
    setForceShowApiBox(false);
    return effective;
  };

  const handleStartQr = useCallback(async () => {
    const creds = validateApiCreds(apiCredsRef.current);
    if (!creds) return;
    setAuthError(null);
    setAuthStep('connecting');
    try {
      await telegramBridge.init(creds, networkRef.current);
      await telegramBridge.startQr();
    } catch (err) {
      setAuthStep('idle');
      const rawMsg = err instanceof Error ? err.message : 'QR login failed';
      setAuthError(
        rawMsg.includes('API_ID_INVALID')
          ? (lang === 'fa'
              ? 'کد API ID یا API Hash وارد شده توسط تلگرام رد شد. لطفاً ارقام و حروف کپی شده از my.telegram.org را در کادر تنظیمات API دوباره بررسی کنید.'
              : 'Telegram rejected this API ID / API Hash. Please verify your credentials on my.telegram.org.')
          : rawMsg
      );
    }
  }, [lang]);

  const handleSendCode = useCallback(async (phone: string) => {
    const creds = validateApiCreds(apiCredsRef.current);
    if (!creds) return;
    setAuthError(null);
    setAuthStep('connecting');
    try {
      await telegramBridge.init(creds, networkRef.current);
      const res = await telegramBridge.sendCode(phone.trim());
      if (res.alreadyAuthorized) {
        await handleAuthorized();
      } else {
        setPhoneState({ phone: phone.trim(), phoneCodeHash: res.phoneCodeHash });
        setAuthStep('code_sent');
      }
    } catch (err) {
      setAuthStep('idle');
      const rawMsg = err instanceof Error ? err.message : 'Failed to send code';
      setAuthError(
        rawMsg.includes('API_ID_INVALID')
          ? (lang === 'fa'
              ? 'کد API ID یا API Hash وارد شده توسط تلگرام رد شد. لطفاً ارقام و حروف کپی شده از my.telegram.org را در کادر تنظیمات API دوباره بررسی کنید.'
              : 'Telegram rejected this API ID / API Hash. Please verify your credentials on my.telegram.org.')
          : rawMsg
      );
    }
  }, [handleAuthorized, lang]);

  const handleVerifyCode = useCallback(async (code: string) => {
    setAuthError(null);
    try {
      const res = await telegramBridge.signIn(
        phoneState.phone,
        phoneState.phoneCodeHash,
        code.trim(),
      );
      if (res.status === 'password_needed') {
        setAuthStep('password_needed');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid confirmation code');
    }
  }, [phoneState.phone, phoneState.phoneCodeHash]);

  const handleCheckPassword = useCallback(async (password: string) => {
    setAuthError(null);
    try {
      await telegramBridge.checkPassword(password);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid 2FA password');
    }
  }, []);

  const handleUnlockSavedSession = async (pin?: string) => {
    setAuthError(null);
    setAuthStep('connecting');
    try {
      const bundle = await loadEncryptedSessionBundle(pin);

      // Automatically restore API credentials & network from the encrypted vault if needed
      let effectiveCreds: ApiCredentials = apiCredsRef.current;
      if (!isValidApiCreds(effectiveCreds) && isValidApiCreds(bundle.apiCreds)) {
        effectiveCreds = bundle.apiCreds;
        setApiCreds(effectiveCreds);
        apiCredsRef.current = effectiveCreds;
        saveApiCredentials(effectiveCreds).catch(() => {});
      }

      if (!validateApiCreds(effectiveCreds)) {
        setAuthStep('idle');
        return;
      }

      let effectiveNetwork = networkRef.current;
      if (bundle.network && effectiveNetwork.mode === 'direct' && bundle.network.mode !== 'direct') {
        effectiveNetwork = bundle.network;
        setNetwork(effectiveNetwork);
        networkRef.current = effectiveNetwork;
        saveNetworkConfig(effectiveNetwork).catch(() => {});
      }

      const res = await telegramBridge.init(effectiveCreds, effectiveNetwork, bundle.sessionString);
      if (res.authorized) {
        const usedPin = (pin ?? '').trim();
        persistenceRef.current = { mode: 'vault', pin: usedPin };
        setPersistenceMode('vault');
        setVaultPin(usedPin);
        await handleAuthorized({ skipPersist: true });
      } else {
        setAuthStep('idle');
        setAuthError(
          res.reason ? `${t.vaultRevokedError} (${res.reason})` : t.vaultRevokedError,
        );
      }
    } catch (err) {
      setAuthStep('idle');
      if (err instanceof VaultError) {
        if (err.code === 'PIN_REQUIRED') {
          setAuthError(t.vaultPinRequiredError);
          return;
        }
        if (err.code === 'WRONG_PIN') {
          setAuthError(t.vaultWrongPinError);
          return;
        }
        if (err.code === 'PIN_LOCKED') {
          setAuthError(t.vaultPinLockedError);
          return;
        }
        if (err.code === 'SESSION_NOT_FOUND') {
          setSavedSessionMeta({ exists: false, hasPin: false });
          setAuthError(err.message);
          return;
        }
        setAuthError(err.message);
        return;
      }
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Failed to reconnect to Telegram. Check your network/proxy settings.',
      );
    }
  };

  const handleSaveSessionToVault = async (pin: string) => {
    const { sessionString } = await telegramBridge.exportSession();
    const meta = await saveEncryptedSessionBundle(
      {
        sessionString,
        apiCreds: apiCredsRef.current,
        network: networkRef.current,
      },
      pin,
    );
    persistenceRef.current = { mode: 'vault', pin: pin.trim() };
    setPersistenceMode('vault');
    setVaultPin(pin.trim());
    setSavedSessionMeta({ exists: true, hasPin: meta.hasPin });
  };

  const handleDiscardSavedSession = useCallback(async () => {
    await clearSavedSession();
    setSavedSessionMeta({ exists: false, hasPin: false });
  }, []);

  const handleLockSession = useCallback(async () => {
    if (!isSampleMode) {
      // Terminate worker/RAM session without calling Telegram logOut or wiping the encrypted vault
      telegramBridge.terminateOnly();
    }
    setVaultPin('');
    setChannels([]);
    setBundlesByChannel({});
    setMediaPreviewsByPost({});
    setLoadingMediaPreview(false);
    setPostDetailsError(null);
    setActiveChannelId(null);
    setSelectedPostKey(null);
    setSelectedDateKey(null);
    setQrUrl(null);
    setQrExpiresAt(null);
    setFloodWaitSec(null);
    setAuthStep('idle');
    setAuthError(null);
  }, [isSampleMode]);

  const handleLogout = useCallback(async () => {
    if (!isSampleMode) {
      await telegramBridge.logoutAndTerminate();
      await clearSavedSession();
      setSavedSessionMeta({ exists: false, hasPin: false });
      const sanitizedNet = sanitizeNetworkForUnencryptedStorage(networkRef.current);
      setNetwork(sanitizedNet);
      networkRef.current = sanitizedNet;
      saveNetworkConfig(sanitizedNet).catch(() => {});
    }
    setVaultPin('');
    setPersistenceMode('ephemeral');
    persistenceRef.current = { mode: 'ephemeral', pin: '' };
    setIsSampleMode(false);
    setChannels([]);
    setBundlesByChannel({});
    setMediaPreviewsByPost({});
    setLoadingMediaPreview(false);
    setPostDetailsError(null);
    setActiveChannelId(null);
    setSelectedPostKey(null);
    setSelectedDateKey(null);
    setQrUrl(null);
    setAuthStep('idle');
    setAuthError(null);
  }, [isSampleMode]);

  const activeBundle = activeChannelId ? bundlesByChannel[activeChannelId] ?? null : null;

  const selectedPost: PostRecord | null = useMemo(() => {
    if (!activeBundle || !selectedPostKey) return null;
    return activeBundle.posts.find((p) => p.key === selectedPostKey) ?? null;
  }, [activeBundle, selectedPostKey]);

  const selectedPreviewCacheKey =
    activeBundle && selectedPost ? `${activeBundle.channel.id}:${selectedPost.key}` : null;

  useEffect(() => {
    if (!selectedPost || !activeBundle || isSampleMode || !selectedPreviewCacheKey) {
      setLoadingMediaPreview(false);
      return;
    }
    if (mediaPreviewsRef.current[selectedPreviewCacheKey]) {
      setLoadingMediaPreview(false);
      return;
    }
    const needsMediaFetch =
      (selectedPost.mediaKind !== 'text' && selectedPost.mediaKind !== 'poll') ||
      Boolean(selectedPost.mediaMeta?.webPageUrl);
    if (!needsMediaFetch) {
      setLoadingMediaPreview(false);
      return;
    }

    let cancelled = false;
    setLoadingMediaPreview(true);
    telegramBridge
      .fetchPostMediaPreview(activeBundle.channel.id, selectedPost.key, selectedPost.messageIds)
      .then((preview) => {
        if (cancelled) return;
        setMediaPreviewsByPost((prev) => ({
          ...prev,
          [selectedPreviewCacheKey]: preview,
        }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingMediaPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeBundle, isSampleMode, selectedPost, selectedPreviewCacheKey]);

  const handleOpenPost = useCallback((p: PostRecord) => {
    setPostDetailsError(null);
    setSelectedPostKey(p.key);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setPostDetailsError(null);
    setSelectedPostKey(null);
  }, []);

  const handleSelectDate = useCallback((dk: string) => {
    startTransition(() => setSelectedDateKey(dk));
  }, []);

  const handleSelectChannel = useCallback(
    async (channelId: number) => {
      startTransition(() => {
        setActiveChannelId(channelId);
        setSelectedPostKey(null);
        const existing = bundlesByChannel[channelId];
        if (existing) {
          setSelectedDateKey(pickDefaultDateKey(existing.overview.interactionsGraph));
        }
      });
      if (!bundlesByChannel[channelId] && !isSampleMode) {
        await loadLiveChannelBundle(channelId, scanDepth);
      }
    },
    [bundlesByChannel, isSampleMode, loadLiveChannelBundle],
  );

  const handleLoadLivePostDetails = useCallback(async (post: PostRecord) => {
    if (!activeBundle || isSampleMode) return;
    setLoadingPostDetails(true);
    setPostDetailsError(null);
    try {
      const details = await telegramBridge.fetchPostDetails(
        activeBundle.channel.id,
        post.primaryId,
        activeBundle.channel.statsDc,
        post.key,
        post.date,
      );
      const evergreen = computeEvergreenRatio(post.date, details.dailyBreakdown);
      const pubCount = Math.min(
        post.forwards,
        details.publicSharesTotal ?? details.publicForwards.length,
      );

      setBundlesByChannel((prev) => {
        const cur = prev[activeBundle.channel.id];
        if (!cur) return prev;
        const nextPostStats = { ...cur.postStatsByPost, [post.key]: details };
        const nextPosts = cur.posts.map((p) =>
          p.key === post.key
            ? {
                ...p,
                publicSharesCount: pubCount,
                privateSharesCount: Math.max(0, p.forwards - pubCount),
                evergreenShareRatio: evergreen,
              }
            : p,
        );
        saveChannelPostStats(cur.channel.id, nextPostStats).catch(() => {});
        return {
          ...prev,
          [activeBundle.channel.id]: {
            ...cur,
            posts: nextPosts,
            postStatsByPost: nextPostStats,
            publicForwardsByPost: {
              ...cur.publicForwardsByPost,
              [post.key]: details.publicForwards,
            },
            scanStatus: {
              ...cur.scanStatus,
              attributedPostsCount: Object.keys(nextPostStats).length,
            },
          },
        };
      });
    } catch (err) {
      setPostDetailsError(
        err instanceof Error ? err.message : t.postStatsErrorMsg,
      );
    } finally {
      setLoadingPostDetails(false);
    }
  }, [activeBundle, isSampleMode, t.postStatsErrorMsg]);

  const handleAbortAttribution = useCallback(() => {
    telegramBridge.abortAttribution().catch(() => {});
  }, []);

  const handleScanDateAttribution = useCallback(async () => {
    if (!activeBundle || isSampleMode || scanningAttribution) return;
    setScanningAttribution(true);
    setAttributionProgress(null);
    setFloodWaitSec(null);
    setLiveError(null);
    try {
      const selectedTs = selectedDateKey
        ? new Date(`${selectedDateKey}T23:59:59Z`).getTime()
        : 0;

      const candidates = activeBundle.posts
        .filter((p) => !activeBundle.postStatsByPost[p.key] && (p.forwards > 0 || p.views > 0))
        .map((p) => ({
          key: p.key,
          primaryId: p.primaryId,
          date: p.date,
          forwards: p.forwards,
          views: p.views,
        }));

      if (selectedTs > 0) {
        // Prioritize posts published on or near the selected date
        candidates.sort((a, b) => {
          // If post is published after selectedDateKey (+ 1 day tolerance for timezone), deprioritize
          const aFuture = a.date > selectedTs + 86400_000;
          const bFuture = b.date > selectedTs + 86400_000;
          if (aFuture && !bFuture) return 1;
          if (!aFuture && bFuture) return -1;

          // Distance in time from the selected date (closer is higher priority)
          const aDist = Math.abs(selectedTs - a.date);
          const bDist = Math.abs(selectedTs - b.date);

          // Posts within 14 days get first priority, sorted by proximity then views/shares
          const aRecent = aDist <= 14 * 86400_000;
          const bRecent = bDist <= 14 * 86400_000;
          if (aRecent && !bRecent) return -1;
          if (!aRecent && bRecent) return 1;

          return aDist - bDist || b.forwards - a.forwards || b.views - a.views;
        });
      } else {
        // No date selected: prioritize recent active posts
        candidates.sort((a, b) => b.date - a.date || b.forwards - a.forwards);
      }

      const results = await telegramBridge.scanDateAttribution(
        activeBundle.channel.id,
        candidates,
        activeBundle.channel.statsDc,
        40,
      );

      setBundlesByChannel((prev) => {
        const cur = prev[activeBundle.channel.id];
        if (!cur) return prev;

        const nextStats = { ...cur.postStatsByPost };
        const nextPubForwards = { ...cur.publicForwardsByPost };
        const resultByKey = new Map(results.map((r) => [r.postKey, r]));

        for (const r of results) {
          nextStats[r.postKey] = r.details;
          if (r.details.publicForwards.length > 0) {
            nextPubForwards[r.postKey] = r.details.publicForwards;
          }
        }

        const nextPosts = cur.posts.map((p) => {
          const item = resultByKey.get(p.key);
          if (!item) return p;
          const pub = Math.min(
            p.forwards,
            item.details.publicSharesTotal ?? item.details.publicForwards.length,
          );
          return {
            ...p,
            publicSharesCount: pub,
            privateSharesCount: Math.max(0, p.forwards - pub),
            evergreenShareRatio: item.evergreenRatio,
          };
        });

        saveChannelSnapshotHistory(cur.channel.id, {
          latestSnapshot: buildSnapshotFromPosts(
            cur.channel.id,
            cur.channel.membersCount,
            nextPosts,
          ),
          dailyDeltas: cur.dailyDeltas,
          postStatsByPost: nextStats,
        }).catch(() => {});

        return {
          ...prev,
          [cur.channel.id]: {
            ...cur,
            posts: nextPosts,
            postStatsByPost: nextStats,
            publicForwardsByPost: nextPubForwards,
            scanStatus: {
              ...cur.scanStatus,
              attributedPostsCount: Object.keys(nextStats).length,
              isComplete: Object.keys(nextStats).length >= nextPosts.length,
            },
          },
        };
      });
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Failed to scan message stats');
    } finally {
      setScanningAttribution(false);
      setAttributionProgress(null);
    }
  }, [activeBundle, isSampleMode, scanningAttribution, selectedDateKey]);

  const handleCaptureSnapshot = useCallback(async () => {
    if (!activeBundle) return;
    const snap = buildSnapshotFromPosts(
      activeBundle.channel.id,
      activeBundle.channel.membersCount,
      activeBundle.posts,
    );
    await saveChannelMetaHistory(activeBundle.channel.id, snap, activeBundle.dailyDeltas);
    setBundlesByChannel((prev) => ({
      ...prev,
      [activeBundle.channel.id]: {
        ...activeBundle,
        lastSnapshotAt: snap.capturedAt,
      },
    }));
  }, [activeBundle]);

  const handleImportSnapshot = useCallback(
    async (snapshot: ChannelSnapshot) => {
      if (!activeBundle) return;
      const recalculated = computeSnapshotDeltas(activeBundle.posts, snapshot);
      const todayKey = formatDateKey(Date.now());
      const extraDeltas: DailyDeltaRecord[] = recalculated
        .filter((p) => p.deltaShares > 0)
        .map((p) => ({
          dateKey: todayKey,
          postKey: p.key,
          primaryId: p.primaryId,
          deltaShares: p.deltaShares,
          deltaViews: p.deltaViews,
        }));

      const mergedDeltas = mergeDailyDeltas(activeBundle.dailyDeltas, extraDeltas);
      await saveChannelMetaHistory(activeBundle.channel.id, snapshot, mergedDeltas);
      setBundlesByChannel((prev) => ({
        ...prev,
        [activeBundle.channel.id]: {
          ...activeBundle,
          posts: recalculated,
          dailyDeltas: mergedDeltas,
          lastSnapshotAt: snapshot.capturedAt,
        },
      }));
    },
    [activeBundle],
  );

  const handleWipeVault = useCallback(async () => {
    await wipeAllVaultData();
    setSavedSessionMeta({ exists: false, hasPin: false });
    setPersistenceMode('ephemeral');
    setVaultPin('');
  }, []);

  if (authStep !== 'authorized') {
    return (
      <>
        <AuthScreen
          lang={lang}
          onToggleLang={() => setLang((l) => (l === 'fa' ? 'en' : 'fa'))}
          network={network}
          onOpenNetworkModal={() => setNetworkModalOpen(true)}
          apiCreds={apiCreds}
          onChangeApiCreds={(next) => {
            setApiCreds(next);
            apiCredsRef.current = next;
            if (!(persistenceRef.current.mode === 'vault' && persistenceRef.current.pin.trim().length > 0)) {
              saveApiCredentials(next).catch(() => {});
            }
          }}
          persistenceMode={persistenceMode}
          vaultPin={vaultPin}
          onChangePersistence={(mode, pin) => {
            persistenceRef.current = { mode, pin };
            setPersistenceMode(mode);
            setVaultPin(pin);
          }}
          savedSessionMeta={savedSessionMeta}
          onUnlockSavedSession={handleUnlockSavedSession}
          onDiscardSavedSession={handleDiscardSavedSession}
          authStep={authStep}
          authError={authError}
          forceShowApiBox={forceShowApiBox}
          qrUrl={qrUrl}
          qrExpiresAt={qrExpiresAt}
          onStartQr={handleStartQr}
          onSendCode={handleSendCode}
          onVerifyCode={handleVerifyCode}
          onCheckPassword={handleCheckPassword}
          onResetAuth={() => {
            setAuthStep('idle');
            setAuthError(null);
            setQrUrl(null);
            setQrExpiresAt(null);
            telegramBridge.abortQr().catch(() => {});
          }}
          onEnterSampleMode={enterSampleMode}
        />

        {networkModalOpen && (
          <Suspense fallback={null}>
            <NetworkModal
              open={networkModalOpen}
              config={network}
              lang={lang}
              onClose={() => setNetworkModalOpen(false)}
              onSave={(next) => {
                setNetwork(next);
                networkRef.current = next;
                saveNetworkConfig(next).catch(() => {});
              }}
            />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen telescope-canvas text-[#F0F4F8] flex">
      <Sidebar
        lang={lang}
        channels={channels}
        activeChannelId={activeChannelId}
        onSelectChannel={handleSelectChannel}
        isSampleMode={isSampleMode}
        persistenceMode={persistenceMode}
        onToggleLang={() => setLang((l) => (l === 'fa' ? 'en' : 'fa'))}
        onOpenVaultModal={() => setSnapshotModalOpen(true)}
        onLockSession={handleLockSession}
        onLogout={handleLogout}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky Frosted Obsidian Header Bar */}
        <header className="sticky top-0 z-30 tg-chrome-glass border-b">
          <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            {/* Zone 1: Channel Avatar & Title */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open channels menu"
                className="lg:hidden rounded-lg p-1.5 text-[#8B9BB0] hover:bg-white/10 hover:text-[#F0F4F8] cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
              {activeBundle && <ChannelAvatar channel={activeBundle.channel} size={30} />}
              <div className="min-w-0">
                <h1 className="text-sm sm:text-[15px] font-semibold text-[#F0F4F8] truncate">
                  {activeBundle?.channel.title ?? t.appName}
                </h1>
              </div>
            </div>

            {/* Zone 2: Clean Segmented Tabs (Desktop) */}
            <nav className="hidden md:flex items-center gap-1 rounded-lg bg-[#090C10]/85 p-1 border border-white/[0.08]">
              {(
                [
                  { id: 'overview', label: t.tabOverview },
                  { id: 'detective', label: t.tabDetective },
                  { id: 'audience', label: t.tabAudience },
                ] as const
              ).map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => startTransition(() => setActiveTab(tab.id))}
                    className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#2AABEE] text-[#090C10] font-semibold'
                        : 'text-[#8B9BB0] hover:text-[#F0F4F8]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            {/* Zone 3: Primary Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSnapshotModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#11161D]/90 px-3 py-1.5 text-xs font-medium text-[#F0F4F8] hover:bg-[#1A222D] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-[#5EC2F6]" />
                <span className="hidden sm:inline">{t.snapshotsBtn}</span>
              </button>

              {!isSampleMode && activeBundle && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <select
                    value={scanDepth}
                    onChange={(e) => setScanDepth(Number(e.target.value) || 400)}
                    disabled={syncingChannel}
                    aria-label={t.scanDepthLabel}
                    className="hidden sm:block rounded-lg border border-white/12 bg-[#11161D]/90 px-2 py-1.5 text-xs font-mono-num text-[#F0F4F8] focus:border-[#2AABEE] focus:outline-none cursor-pointer"
                  >
                    <option value={400}>400</option>
                    <option value={1000}>1000</option>
                    <option value={2500}>2500</option>
                  </select>
                  <button
                    type="button"
                    disabled={syncingChannel}
                    onClick={() => loadLiveChannelBundle(activeBundle.channel.id, scanDepth)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2AABEE] px-3 py-1.5 text-xs font-semibold text-[#090C10] hover:bg-[#3CB7F5] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingChannel ? 'animate-spin' : ''}`} />
                    <span>{syncingChannel ? `${t.syncingText} (${scanProgressCount})` : t.syncNowBtn}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Tab Strip */}
          <div className="flex md:hidden border-t border-white/[0.08] px-3 py-1.5 gap-1 justify-between">
            {(
              [
                { id: 'overview', label: lang === 'fa' ? 'نمای کلی' : 'Overview' },
                { id: 'detective', label: lang === 'fa' ? 'پست‌ها و ویرال' : 'Posts' },
                { id: 'audience', label: lang === 'fa' ? 'زمان‌بندی' : 'Timing' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => startTransition(() => setActiveTab(tab.id))}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                    active ? 'bg-[#2AABEE] text-[#090C10] font-semibold' : 'text-[#8B9BB0]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Main Workspace Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-4">
          {liveError && (
            <div
              role="alert"
              className="rounded-xl border border-[#e55353]/40 bg-[#e55353]/10 px-4 py-3 text-xs text-[#fca5a5]"
            >
              {liveError}
            </div>
          )}

          {!activeBundle ? (
            syncingChannel ? (
              <div className="space-y-4">
                <div className="tg-panel rounded-xl p-5 border border-[#2AABEE]/25 bg-[#0B0F14]/90 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <RefreshCw className="w-4 h-4 text-[#2AABEE] animate-spin" />
                      <div>
                        <div className="text-sm font-semibold text-[#F0F4F8]">
                          {t.syncingText}
                        </div>
                        <div className="text-xs text-[#8B9BB0] mt-0.5">
                          {t.syncingChannelSub}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs font-mono-num font-semibold px-2.5 py-1 rounded-md bg-[#2AABEE]/15 text-[#5EC2F6] border border-[#2AABEE]/30">
                      {scanProgressCount} {lang === 'fa' ? 'پیام دریافت شد' : 'messages scanned'}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                    <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center gap-2.5 text-xs text-[#22C55E]">
                      <div className="w-2 h-2 rounded-full bg-[#22C55E] shrink-0" />
                      <span className="truncate">{t.syncStep1}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center gap-2.5 text-xs text-[#F59E0B]">
                      <div className="w-2 h-2 rounded-full bg-[#F59E0B] animate-ping shrink-0" />
                      <span className="truncate">{t.syncStep2}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center gap-2.5 text-xs text-[#8B9BB0]">
                      <div className="w-2 h-2 rounded-full bg-[#8B9BB0] shrink-0" />
                      <span className="truncate">{t.syncStep3}</span>
                    </div>
                  </div>
                </div>

                <div className="tg-panel rounded-xl overflow-hidden p-5 space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="space-y-2 animate-pulse">
                        <div className="h-6 w-20 bg-white/[0.08] rounded-md" />
                        <div className="h-3 w-14 bg-white/[0.04] rounded" />
                      </div>
                    ))}
                  </div>
                  <div className="h-56 rounded-lg bg-white/[0.02] border border-white/[0.04] flex items-center justify-center animate-pulse">
                    <span className="text-xs text-[#8596AA] font-mono-num">
                      {lang === 'fa' ? 'در حال رندر گراف‌های MTProto...' : 'Rendering MTProto graphs...'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="tg-panel rounded-2xl p-8 text-center text-sm text-[#7f91a4]">
                {t.noChannels}
              </div>
            )
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewTab
                  lang={lang}
                  bundle={activeBundle}
                  isSampleMode={isSampleMode}
                  selectedDateKey={selectedDateKey}
                  scanningAttribution={scanningAttribution}
                  attributionProgress={attributionProgress}
                  floodWaitSec={floodWaitSec}
                  onScanAttribution={handleScanDateAttribution}
                  onAbortAttribution={handleAbortAttribution}
                  onSelectDate={handleSelectDate}
                  onOpenPost={handleOpenPost}
                />
              )}

              <Suspense fallback={null}>
                {activeTab === 'detective' && (
                  <ShareDetectiveTab
                    lang={lang}
                    posts={activeBundle.posts}
                    onOpenPost={handleOpenPost}
                  />
                )}

                {activeTab === 'audience' && (
                  <AudienceTab
                    lang={lang}
                    bundle={activeBundle}
                    timezoneMode={timezoneMode}
                    onChangeTimezoneMode={setTimezoneMode}
                  />
                )}
              </Suspense>
            </>
          )}
        </main>
      </div>

      {/* Post Deep Inspector Drawer */}
      {selectedPost && (
        <Suspense fallback={null}>
          <PostDetailDrawer
            lang={lang}
            post={selectedPost}
            details={activeBundle ? activeBundle.postStatsByPost[selectedPost.key] : undefined}
            mediaPreview={
              selectedPreviewCacheKey ? mediaPreviewsByPost[selectedPreviewCacheKey] : undefined
            }
            loadingMediaPreview={loadingMediaPreview}
            publicForwards={
              activeBundle ? activeBundle.publicForwardsByPost[selectedPost.key] ?? [] : []
            }
            isSampleMode={isSampleMode}
            loadingDetails={loadingPostDetails}
            detailsError={postDetailsError}
            onLoadLiveDetails={handleLoadLivePostDetails}
            onClose={handleCloseDrawer}
          />
        </Suspense>
      )}

      {/* Snapshots & Vault Modal */}
      {snapshotModalOpen && (
        <Suspense fallback={null}>
          <SnapshotModal
            open={snapshotModalOpen}
            lang={lang}
            bundle={activeBundle}
            isSampleMode={isSampleMode}
            onClose={() => setSnapshotModalOpen(false)}
            onCaptureSnapshot={handleCaptureSnapshot}
            onImportSnapshot={handleImportSnapshot}
            onSaveSessionToVault={handleSaveSessionToVault}
            onWipeVault={handleWipeVault}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
