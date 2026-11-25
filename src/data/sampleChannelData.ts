import type {
  ChannelAnalyticsBundle,
  ChannelSummary,
  MessageDailyActivity,
  PostDetailedStats,
  PostRecord,
  PublicForwardRecord,
  RawChannelMessage,
} from '../types/analytics';
import {
  computeEvergreenRatio,
  computeFormatInsights,
  computeSnapshotDeltas,
  extractDailyActivityFromGraph,
  formatDateKey,
  groupAlbumPosts,
  parseTelegramStatsGraph,
} from '../utils/analyticsMath';

// Clean, general-purpose public demo window (10-day observation span)
const DATES_10D = Array.from({ length: 10 }, (_, i) => Date.UTC(2026, 9, 15 + i));
const HOURS_24 = Array.from({ length: 24 }, (_, h) => Date.UTC(2026, 9, 24, h, 0));

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

const CHANNEL_1_AVATAR = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B4F7A"/>
      <stop offset="100%" stop-color="#2AABEE"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="60" fill="url(#g1)"/>
  <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
  <path d="M30 72 L48 48 L64 62 L90 36" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="90" cy="36" r="6" fill="#45D168"/>
</svg>
`);

const CHANNEL_2_AVATAR = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#133D29"/>
      <stop offset="100%" stop-color="#45D168"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="60" fill="url(#g2)"/>
  <rect x="34" y="48" width="8" height="24" rx="4" fill="#fff"/>
  <rect x="48" y="34" width="8" height="52" rx="4" fill="#fff"/>
  <rect x="62" y="42" width="8" height="36" rx="4" fill="#fff"/>
  <rect x="76" y="28" width="8" height="64" rx="4" fill="#F5A623"/>
</svg>
`);

const SAMPLE_PHOTO_GLASS = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#09131E"/>
      <stop offset="50%" stop-color="#112A42"/>
      <stop offset="100%" stop-color="#0D1824"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="180" cy="110" r="110" fill="#2AABEE" fill-opacity="0.22"/>
  <circle cx="480" cy="250" r="120" fill="#45D168" fill-opacity="0.16"/>
  <rect x="72" y="64" width="496" height="232" rx="22" fill="rgba(17,22,29,0.72)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  <rect x="104" y="102" width="170" height="16" rx="8" fill="#5EC2F6"/>
  <rect x="104" y="136" width="290" height="10" rx="5" fill="rgba(240,244,248,0.45)"/>
  <path d="M104 245 L190 212 L275 228 L360 172 L450 192 L536 140" fill="none" stroke="#45D168" stroke-width="4" stroke-linecap="round"/>
  <path d="M104 258 L190 250 L275 244 L360 226 L450 232 L536 206" fill="none" stroke="#F5A623" stroke-width="4" stroke-linecap="round"/>
</svg>
`);

const SAMPLE_PHOTO_STATS = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#0B1118"/>
  <rect x="52" y="48" width="536" height="264" rx="18" fill="#131B24" stroke="rgba(94,194,246,0.28)" stroke-width="2"/>
  <rect x="90" y="92" width="140" height="58" rx="10" fill="#182534"/>
  <rect x="250" y="92" width="140" height="58" rx="10" fill="#182534"/>
  <rect x="410" y="92" width="140" height="58" rx="10" fill="#182534"/>
  <polyline points="90,260 165,244 240,222 315,235 390,180 465,196 550,148" fill="none" stroke="#2AABEE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`);

const SAMPLE_VIDEO_POSTER = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#0A0F15"/>
  <rect x="40" y="36" width="560" height="288" rx="16" fill="#101822" stroke="rgba(255,255,255,0.12)"/>
  <path d="M80 248 Q180 120 290 198 T560 112" fill="none" stroke="#5EC2F6" stroke-width="5"/>
  <circle cx="320" cy="180" r="34" fill="rgba(42,171,238,0.28)" stroke="#2AABEE" stroke-width="2"/>
</svg>
`);

const SAMPLE_AUDIO_COVER = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <defs>
    <linearGradient id="ac" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#D91E2A"/>
      <stop offset="100%" stop-color="#7B0B14"/>
    </linearGradient>
  </defs>
  <rect width="240" height="240" rx="20" fill="url(#ac)"/>
  <circle cx="120" cy="120" r="68" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="4"/>
  <circle cx="120" cy="120" r="22" fill="#0B0F14"/>
  <path d="M52 178 L188 62" stroke="rgba(255,255,255,0.25)" stroke-width="6" stroke-linecap="round"/>
</svg>
`);

const SAMPLE_CHANNELS: ChannelSummary[] = [
  {
    id: 1004821930,
    title: 'Vektor Tech Digest',
    username: 'vektortech',
    membersCount: 1840,
    isCreator: true,
    isAdmin: true,
    canViewStats: true,
    statsDc: 4,
    lastSyncedAt: Date.UTC(2026, 9, 24, 18, 0),
    avatarColor: '#2aabee',
    avatarUrl: CHANNEL_1_AVATAR,
  },
  {
    id: 1007392014,
    title: 'استودیو سیگنال · Studio Signal',
    username: 'studiosignal',
    membersCount: 620,
    isCreator: false,
    isAdmin: true,
    canViewStats: true,
    statsDc: 2,
    lastSyncedAt: Date.UTC(2026, 9, 24, 16, 45),
    avatarColor: '#45d168',
    avatarUrl: CHANNEL_2_AVATAR,
  },
];

function buildGraphJson(
  dates: number[],
  series: Array<{
    key: string;
    name: string;
    color: string;
    type: 'line' | 'bar' | 'area';
    values: number[];
  }>,
): string {
  const columns: Array<[string, ...number[]]> = [['x', ...dates]];
  const types: Record<string, string> = { x: 'x' };
  const names: Record<string, string> = {};
  const colors: Record<string, string> = {};

  for (const s of series) {
    columns.push([s.key, ...s.values]);
    types[s.key] = s.type;
    names[s.key] = s.name;
    colors[s.key] = `LIGHT${s.color}`;
  }

  return JSON.stringify({ columns, types, names, colors });
}

interface DailySeed {
  postKey: string;
  primaryId: number;
  dailyViews: number[]; // length 10 matching DATES_10D
  dailyShares: number[]; // length 10 matching DATES_10D
  publicForwards?: PublicForwardRecord[];
}

function buildPostStatsMap(
  posts: PostRecord[],
  seeds: DailySeed[],
  loadedAt: number,
): {
  postStatsByPost: Record<string, PostDetailedStats>;
  publicForwardsByPost: Record<string, PublicForwardRecord[]>;
  enrichedPosts: PostRecord[];
  channelDailyViews: number[];
  channelDailyShares: number[];
} {
  const postStatsByPost: Record<string, PostDetailedStats> = {};
  const publicForwardsByPost: Record<string, PublicForwardRecord[]> = {};
  const channelDailyViews = new Array<number>(DATES_10D.length).fill(0);
  const channelDailyShares = new Array<number>(DATES_10D.length).fill(0);

  const seedByKey = new Map(seeds.map((s) => [s.postKey, s]));

  const enrichedPosts = posts.map((post) => {
    const seed = seedByKey.get(post.key);
    if (!seed) return post;

    for (let i = 0; i < DATES_10D.length; i += 1) {
      channelDailyViews[i] += seed.dailyViews[i] ?? 0;
      channelDailyShares[i] += seed.dailyShares[i] ?? 0;
    }

    const viewsGraph = parseTelegramStatsGraph(
      `post-${post.primaryId}-views`,
      'Interactions',
      buildGraphJson(DATES_10D, [
        { key: 'y0', name: 'Views', color: '#45d168', type: 'line', values: seed.dailyViews },
        { key: 'y1', name: 'Shares', color: '#f5a623', type: 'line', values: seed.dailyShares },
      ]),
    );

    const dailyBreakdown: MessageDailyActivity[] = extractDailyActivityFromGraph(viewsGraph);
    const pubList = seed.publicForwards ?? [];
    if (pubList.length > 0) {
      publicForwardsByPost[post.key] = pubList;
    }

    const evergreenShareRatio = computeEvergreenRatio(post.date, dailyBreakdown);
    const publicSharesCount = Math.min(post.forwards, pubList.length);
    const privateSharesCount = Math.max(0, post.forwards - publicSharesCount);

    postStatsByPost[post.key] = {
      postKey: post.key,
      primaryId: post.primaryId,
      viewsGraph,
      dailyBreakdown,
      publicForwards: pubList,
      publicSharesTotal: publicSharesCount,
      loadedAt,
    };

    return {
      ...post,
      publicSharesCount,
      privateSharesCount,
      evergreenShareRatio,
    };
  });

  return {
    postStatsByPost,
    publicForwardsByPost,
    enrichedPosts,
    channelDailyViews,
    channelDailyShares,
  };
}

const CHANNEL_1_MESSAGES: RawChannelMessage[] = [
  {
    id: 540,
    date: Date.UTC(2026, 9, 24, 15, 10),
    text: 'Benchmarking WebAssembly MTProto encryption inside a dedicated Worker thread vs main-thread execution.',
    views: 1420,
    forwards: 18,
    replies: 14,
    groupedId: null,
    mediaKind: 'text',
    mediaMeta: {
      title: 'Worker-Isolated MTProto Benchmarks (WASM + WebCrypto)',
      webPageSite: 'vektortech.dev',
      webPageUrl: 'https://vektortech.dev/notes/mtproto-worker-benchmarks',
    },
    reactions: [
      { emoji: '🔥', count: 42 },
      { emoji: '👍', count: 29 },
    ],
    permalink: 'https://t.me/vektortech/540',
  },
  {
    id: 538,
    date: Date.UTC(2026, 9, 23, 18, 25),
    text: 'Minimalist glassmorphism in desktop clients: balancing backdrop blur cost with 120Hz scroll budgets.',
    views: 1180,
    forwards: 11,
    replies: 8,
    groupedId: null,
    mediaKind: 'photo',
    mediaMeta: {
      width: 1280,
      height: 720,
      thumbUrl: SAMPLE_PHOTO_GLASS,
    },
    reactions: [
      { emoji: '❤️', count: 38 },
      { emoji: '🔥', count: 21 },
    ],
    permalink: 'https://t.me/vektortech/538',
  },
  {
    id: 535,
    date: Date.UTC(2026, 9, 21, 13, 40),
    text: 'Weekly release digest: faster reconnection backoff and lower battery drain on mobile webviews.',
    views: 960,
    forwards: 3,
    replies: 5,
    groupedId: null,
    mediaKind: 'text',
    reactions: [{ emoji: '👍', count: 24 }],
    permalink: 'https://t.me/vektortech/535',
  },
  {
    id: 532,
    date: Date.UTC(2026, 9, 20, 17, 5),
    text: 'Quick poll: which transport mode do you rely on most for channel administration?',
    views: 1090,
    forwards: 0,
    replies: 19,
    groupedId: null,
    mediaKind: 'poll',
    mediaMeta: {
      pollQuestion: 'Which transport mode do you rely on most for channel administration?',
      pollVoters: 412,
      pollIsQuiz: false,
      pollIsClosed: false,
      pollOptions: [
        { text: 'Direct WebSocket (DC1–DC5)', voters: 238 },
        { text: 'Local SOCKS5 Bridge', voters: 112 },
        { text: 'Cloudflare Worker Relay', voters: 62 },
      ],
    },
    reactions: [{ emoji: '🤔', count: 16 }],
    permalink: 'https://t.me/vektortech/532',
  },
  {
    id: 529,
    date: Date.UTC(2026, 9, 18, 11, 20),
    text: 'How per-message interaction graphs track private forwards and Saved Messages activity.',
    views: 1310,
    forwards: 16,
    replies: 12,
    groupedId: null,
    mediaKind: 'photo',
    mediaMeta: {
      width: 1280,
      height: 720,
      thumbUrl: SAMPLE_PHOTO_STATS,
    },
    reactions: [
      { emoji: '🔥', count: 36 },
      { emoji: '👏', count: 14 },
    ],
    permalink: 'https://t.me/vektortech/529',
  },
  // Older evergreen posts (outside 7-day Recent Posts window!)
  {
    id: 514,
    date: Date.UTC(2026, 9, 11, 16, 45),
    text: 'Complete Checklist: Zero-Backend Threat Model & WebCrypto AES-256-GCM Session Vaults (PDF Guide).',
    views: 3420,
    forwards: 84,
    replies: 31,
    groupedId: null,
    mediaKind: 'document',
    mediaMeta: {
      fileName: 'Zero-Backend-Threat-Model-v2.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 2_840_000,
    },
    reactions: [
      { emoji: '🔥', count: 112 },
      { emoji: '❤️', count: 64 },
      { emoji: '👍', count: 48 },
    ],
    permalink: 'https://t.me/vektortech/514',
  },
  {
    id: 498,
    date: Date.UTC(2026, 9, 3, 19, 15),
    text: 'Systems Architecture Pack: Local SOCKS5 Bridge + Cloudflare Relay Diagrams (3-part album).',
    views: 2890,
    forwards: 58,
    replies: 22,
    groupedId: '771029384',
    mediaKind: 'photo',
    mediaMeta: {
      width: 1280,
      height: 720,
      thumbUrl: SAMPLE_PHOTO_GLASS,
    },
    reactions: [
      { emoji: '❤️', count: 78 },
      { emoji: '🔥', count: 59 },
    ],
    permalink: 'https://t.me/vektortech/498',
  },
  {
    id: 499,
    date: Date.UTC(2026, 9, 3, 19, 15),
    text: '',
    views: 2840,
    forwards: 39,
    replies: 0,
    groupedId: '771029384',
    mediaKind: 'document',
    mediaMeta: {
      fileName: 'Relay-Topology-Schema.svg',
      mimeType: 'image/svg+xml',
      fileSizeBytes: 184_320,
    },
    reactions: [],
    permalink: 'https://t.me/vektortech/499',
  },
  {
    id: 500,
    date: Date.UTC(2026, 9, 3, 19, 15),
    text: '',
    views: 2810,
    forwards: 27,
    replies: 0,
    groupedId: '771029384',
    mediaKind: 'photo',
    mediaMeta: {
      width: 1280,
      height: 720,
      thumbUrl: SAMPLE_PHOTO_STATS,
    },
    reactions: [],
    permalink: 'https://t.me/vektortech/500',
  },
  {
    id: 480,
    date: Date.UTC(2026, 8, 26, 14, 0),
    text: 'Screen recording: Sub-millisecond SVG timeline scrubbing with zero layout thrashing.',
    views: 2150,
    forwards: 34,
    replies: 15,
    groupedId: null,
    mediaKind: 'video',
    mediaMeta: {
      fileName: 'svg-timeline-scrubbing-120hz.mp4',
      mimeType: 'video/mp4',
      durationSec: 47,
      width: 1920,
      height: 1080,
      fileSizeBytes: 11_450_000,
      thumbUrl: SAMPLE_VIDEO_POSTER,
    },
    reactions: [
      { emoji: '🔥', count: 52 },
      { emoji: '👏', count: 19 },
    ],
    permalink: 'https://t.me/vektortech/480',
  },
];

const CHANNEL_1_SEEDS: DailySeed[] = [
  {
    postKey: 'msg:540',
    primaryId: 540,
    dailyViews: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1420],
    dailyShares: [0, 0, 0, 0, 0, 0, 0, 0, 0, 18],
    publicForwards: [
      {
        channelId: 1009021,
        channelTitle: 'Frontend Systems Weekly',
        channelUsername: 'fesystems',
        messageId: 2140,
        date: Date.UTC(2026, 9, 24, 19, 20),
        views: 6820,
      },
      {
        channelId: 1009044,
        channelTitle: 'WebAssembly Digest',
        channelUsername: 'wasmdigest',
        messageId: 891,
        date: Date.UTC(2026, 9, 24, 21, 5),
        views: 4190,
      },
    ],
  },
  {
    postKey: 'msg:538',
    primaryId: 538,
    dailyViews: [0, 0, 0, 0, 0, 0, 0, 0, 910, 270],
    dailyShares: [0, 0, 0, 0, 0, 0, 0, 0, 9, 2],
    publicForwards: [
      {
        channelId: 1009110,
        channelTitle: 'UI Craft & Motion',
        channelUsername: 'uicraft',
        messageId: 1403,
        date: Date.UTC(2026, 9, 23, 20, 40),
        views: 3400,
      },
    ],
  },
  {
    postKey: 'msg:535',
    primaryId: 535,
    dailyViews: [0, 0, 0, 0, 0, 0, 740, 150, 45, 25],
    dailyShares: [0, 0, 0, 0, 0, 0, 2, 1, 0, 0],
  },
  {
    postKey: 'msg:532',
    primaryId: 532,
    dailyViews: [0, 0, 0, 0, 0, 820, 180, 60, 20, 10],
    dailyShares: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    postKey: 'msg:529',
    primaryId: 529,
    dailyViews: [0, 0, 0, 890, 240, 80, 45, 25, 18, 12],
    dailyShares: [0, 0, 0, 11, 3, 1, 1, 0, 0, 0],
  },
  {
    postKey: 'msg:514',
    primaryId: 514,
    // Evergreen PDF guide: shared heavily on Oct 20 (day idx 5) and Oct 22 (day idx 7)!
    dailyViews: [64, 52, 48, 58, 70, 310, 95, 240, 88, 72],
    dailyShares: [2, 1, 1, 2, 3, 14, 3, 10, 2, 2],
    publicForwards: [
      {
        channelId: 1009288,
        channelTitle: 'Applied Cryptography Notes',
        channelUsername: 'cryptonotes',
        messageId: 612,
        date: Date.UTC(2026, 9, 20, 14, 15),
        views: 9240,
      },
      {
        channelId: 1009312,
        channelTitle: 'Open Source Security',
        channelUsername: 'oss_sec',
        messageId: 3340,
        date: Date.UTC(2026, 9, 22, 11, 30),
        views: 5180,
      },
    ],
  },
  {
    postKey: 'album:771029384',
    primaryId: 498,
    // Older album receiving steady organic forwards on Oct 20 & Oct 22
    dailyViews: [45, 38, 42, 40, 36, 185, 62, 145, 50, 44],
    dailyShares: [1, 1, 1, 0, 1, 7, 2, 6, 1, 1],
    publicForwards: [
      {
        channelId: 1009401,
        channelTitle: 'Self-Hosted Network Lab',
        channelUsername: 'netlab_selfhost',
        messageId: 1775,
        date: Date.UTC(2026, 9, 20, 18, 0),
        views: 4890,
      },
    ],
  },
  {
    postKey: 'msg:480',
    primaryId: 480,
    dailyViews: [28, 24, 19, 22, 18, 35, 21, 48, 25, 19],
    dailyShares: [0, 1, 0, 0, 0, 2, 0, 2, 1, 0],
  },
];

const CHANNEL_2_MESSAGES: RawChannelMessage[] = [
  {
    id: 218,
    date: Date.UTC(2026, 9, 24, 14, 30),
    text: 'طراحی سیستم رنگ لیکوید گلس و سلسله‌مراتب تایپوگرافی دوزبانه (فارسی/انگلیسی)',
    views: 510,
    forwards: 9,
    replies: 6,
    groupedId: null,
    mediaKind: 'photo',
    mediaMeta: {
      width: 1280,
      height: 720,
      thumbUrl: SAMPLE_PHOTO_GLASS,
    },
    reactions: [
      { emoji: '❤️', count: 24 },
      { emoji: '🔥', count: 14 },
    ],
    permalink: 'https://t.me/studiosignal/218',
  },
  {
    id: 215,
    date: Date.UTC(2026, 9, 22, 18, 15),
    text: '',
    views: 430,
    forwards: 4,
    replies: 3,
    groupedId: null,
    mediaKind: 'audio',
    mediaMeta: {
      title: 'Analog Midnight (Mastered Cut)',
      performer: 'Studio Signal',
      durationSec: 214,
      fileName: 'Analog_Midnight_Mastered.mp3',
      mimeType: 'audio/mpeg',
      fileSizeBytes: 8_420_000,
      thumbUrl: SAMPLE_AUDIO_COVER,
    },
    reactions: [{ emoji: '🔥', count: 18 }],
    permalink: 'https://t.me/studiosignal/215',
  },
  {
    id: 211,
    date: Date.UTC(2026, 9, 20, 20, 0),
    text: 'نکات کلیدی میکس وکال در فضاهای آکوستیک خانگی بدون تجهیزات استودیویی گران‌قیمت',
    views: 390,
    forwards: 0,
    replies: 4,
    groupedId: null,
    mediaKind: 'text',
    reactions: [{ emoji: '👍', count: 15 }],
    permalink: 'https://t.me/studiosignal/211',
  },
  {
    id: 194,
    date: Date.UTC(2026, 9, 10, 17, 30),
    text: 'پکیج کامل پریست‌ها و فایل PDF راهنمای مسترینگ (آلبوم ۲ قسمتی)',
    views: 980,
    forwards: 26,
    replies: 11,
    groupedId: '662109445',
    mediaKind: 'photo',
    mediaMeta: {
      width: 1280,
      height: 720,
      thumbUrl: SAMPLE_PHOTO_STATS,
    },
    reactions: [
      { emoji: '🔥', count: 41 },
      { emoji: '❤️', count: 33 },
    ],
    permalink: 'https://t.me/studiosignal/194',
  },
  {
    id: 195,
    date: Date.UTC(2026, 9, 10, 17, 30),
    text: '',
    views: 955,
    forwards: 19,
    replies: 0,
    groupedId: '662109445',
    mediaKind: 'document',
    mediaMeta: {
      fileName: 'Mastering-Presets-Guide.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4_120_000,
    },
    reactions: [],
    permalink: 'https://t.me/studiosignal/195',
  },
  {
    id: 182,
    date: Date.UTC(2026, 9, 2, 16, 10),
    text: 'ویدیوی پشت‌صحنه طراحی صدا و سینتی‌سایزر ماژولار',
    views: 840,
    forwards: 15,
    replies: 7,
    groupedId: null,
    mediaKind: 'video',
    mediaMeta: {
      fileName: 'modular-synth-session.mp4',
      mimeType: 'video/mp4',
      durationSec: 126,
      width: 1920,
      height: 1080,
      fileSizeBytes: 18_700_000,
      thumbUrl: SAMPLE_VIDEO_POSTER,
    },
    reactions: [{ emoji: '👏', count: 29 }],
    permalink: 'https://t.me/studiosignal/182',
  },
];

const CHANNEL_2_SEEDS: DailySeed[] = [
  {
    postKey: 'msg:218',
    primaryId: 218,
    dailyViews: [0, 0, 0, 0, 0, 0, 0, 0, 0, 510],
    dailyShares: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9],
    publicForwards: [
      {
        channelId: 1008812,
        channelTitle: 'گرافیک و دیزاین مدرن',
        channelUsername: 'moderndesign_fa',
        messageId: 4920,
        date: Date.UTC(2026, 9, 24, 18, 0),
        views: 2640,
      },
    ],
  },
  {
    postKey: 'msg:215',
    primaryId: 215,
    dailyViews: [0, 0, 0, 0, 0, 0, 0, 340, 60, 30],
    dailyShares: [0, 0, 0, 0, 0, 0, 0, 3, 1, 0],
  },
  {
    postKey: 'msg:211',
    primaryId: 211,
    dailyViews: [0, 0, 0, 0, 0, 310, 55, 15, 6, 4],
    dailyShares: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    postKey: 'album:662109445',
    primaryId: 194,
    // Older album driving shares on Oct 20 (idx 5) and Oct 22 (idx 7)
    dailyViews: [32, 28, 30, 26, 24, 140, 42, 95, 38, 31],
    dailyShares: [1, 0, 1, 0, 1, 6, 1, 4, 1, 1],
    publicForwards: [
      {
        channelId: 1008901,
        channelTitle: 'آکادمی صدابرداری و مسترینگ',
        channelUsername: 'audiomaster_fa',
        messageId: 1129,
        date: Date.UTC(2026, 9, 20, 21, 10),
        views: 3150,
      },
    ],
  },
  {
    postKey: 'msg:182',
    primaryId: 182,
    dailyViews: [18, 16, 14, 15, 12, 34, 19, 28, 15, 14],
    dailyShares: [0, 1, 0, 0, 0, 2, 0, 1, 0, 0],
  },
];

function createChannel1Bundle(): ChannelAnalyticsBundle {
  const recentIds = new Set([540, 538, 535, 532, 529]);
  const grouped = groupAlbumPosts(CHANNEL_1_MESSAGES, recentIds);

  const prevSnapshot = {
    channelId: SAMPLE_CHANNELS[0].id,
    capturedAt: Date.UTC(2026, 9, 23, 22, 0),
    membersCount: 1812,
    posts: {
      'msg:540': { views: 0, forwards: 0, reactions: 0, replies: 0 },
      'msg:538': { views: 910, forwards: 9, reactions: 50, replies: 6 },
      'msg:535': { views: 935, forwards: 3, reactions: 23, replies: 5 },
      'msg:532': { views: 1080, forwards: 0, reactions: 16, replies: 19 },
      'msg:529': { views: 1298, forwards: 16, reactions: 49, replies: 12 },
      'msg:514': { views: 3348, forwards: 82, reactions: 220, replies: 30 },
      'album:771029384': { views: 2846, forwards: 57, reactions: 135, replies: 22 },
      'msg:480': { views: 2131, forwards: 34, reactions: 70, replies: 15 },
    },
  };

  const withDeltas = computeSnapshotDeltas(grouped, prevSnapshot);
  const {
    postStatsByPost,
    publicForwardsByPost,
    enrichedPosts,
    channelDailyViews,
    channelDailyShares,
  } = buildPostStatsMap(withDeltas, CHANNEL_1_SEEDS, Date.UTC(2026, 9, 24, 18, 0));

  return {
    channel: SAMPLE_CHANNELS[0],
    overview: {
      periodFrom: DATES_10D[0],
      periodTo: DATES_10D[DATES_10D.length - 1],
      followers: { current: 1840, previous: 1715 },
      viewsPerPost: { current: 1380, previous: 1190 },
      sharesPerPost: { current: 24.5, previous: 18.2 },
      reactionsPerPost: { current: 54.0, previous: 42.5 },
      enabledNotificationsPercent: 58.4,
      recentPostIds: Array.from(recentIds),
      interactionsGraph: parseTelegramStatsGraph(
        'interactions-1',
        'Interactions',
        buildGraphJson(DATES_10D, [
          { key: 'y0', name: 'Views', color: '#45d168', type: 'line', values: channelDailyViews },
          { key: 'y1', name: 'Shares', color: '#f5a623', type: 'line', values: channelDailyShares },
        ]),
      ),
      growthGraph: parseTelegramStatsGraph(
        'growth-1',
        'Growth',
        buildGraphJson(DATES_10D, [
          {
            key: 'y0',
            name: 'Subscribers',
            color: '#2aabee',
            type: 'line',
            values: [1715, 1726, 1740, 1756, 1769, 1791, 1802, 1815, 1828, 1840],
          },
        ]),
      ),
      followersGraph: parseTelegramStatsGraph(
        'followers-1',
        'Followers',
        buildGraphJson(DATES_10D, [
          { key: 'y0', name: 'Joined', color: '#45d168', type: 'bar', values: [14, 15, 18, 21, 17, 29, 15, 19, 16, 18] },
          { key: 'y1', name: 'Left', color: '#ef5a5a', type: 'bar', values: [3, 4, 4, 5, 4, 7, 4, 6, 3, 6] },
        ]),
      ),
      topHoursGraph: parseTelegramStatsGraph(
        'topHours-1',
        'Top Hours',
        buildGraphJson(HOURS_24, [
          {
            key: 'y0',
            name: 'This week',
            color: '#2aabee',
            type: 'line',
            values: [95, 62, 41, 28, 24, 38, 84, 190, 320, 460, 510, 560, 590, 540, 620, 710, 790, 860, 820, 740, 610, 470, 290, 160],
          },
        ]),
      ),
      viewsBySourceGraph: parseTelegramStatsGraph(
        'viewsBySource-1',
        'Views by Source',
        buildGraphJson(DATES_10D, [
          { key: 'y0', name: 'Followers', color: '#2aabee', type: 'area', values: [90, 75, 68, 620, 210, 820, 650, 320, 680, 990] },
          { key: 'y1', name: 'Forwards & Channels', color: '#45d168', type: 'area', values: [27, 22, 21, 240, 86, 380, 260, 138, 290, 390] },
          { key: 'y2', name: 'Search & Links', color: '#f5a623', type: 'area', values: [20, 17, 20, 150, 68, 150, 173, 90, 151, 192] },
        ]),
      ),
      languagesGraph: parseTelegramStatsGraph(
        'languages-1',
        'Languages',
        buildGraphJson([DATES_10D[DATES_10D.length - 1]], [
          { key: 'y0', name: 'English (en)', color: '#2aabee', type: 'area', values: [72] },
          { key: 'y1', name: 'Persian (fa)', color: '#45d168', type: 'area', values: [21] },
          { key: 'y2', name: 'Other', color: '#f5a623', type: 'area', values: [7] },
        ]),
      ),
    },
    posts: enrichedPosts,
    dailyDeltas: [
      {
        dateKey: formatDateKey(DATES_10D[9]),
        postKey: 'msg:540',
        primaryId: 540,
        deltaShares: 18,
        deltaViews: 1420,
      },
      {
        dateKey: formatDateKey(DATES_10D[9]),
        postKey: 'msg:514',
        primaryId: 514,
        deltaShares: 2,
        deltaViews: 72,
      },
    ],
    publicForwardsByPost,
    postStatsByPost,
    lastSnapshotAt: prevSnapshot.capturedAt,
    scanStatus: {
      scannedCount: CHANNEL_1_MESSAGES.length,
      attributedPostsCount: Object.keys(postStatsByPost).length,
      isComplete: true,
    },
  };
}

function createChannel2Bundle(): ChannelAnalyticsBundle {
  const recentIds = new Set([218, 215, 211]);
  const grouped = groupAlbumPosts(CHANNEL_2_MESSAGES, recentIds);

  const prevSnapshot = {
    channelId: SAMPLE_CHANNELS[1].id,
    capturedAt: Date.UTC(2026, 9, 23, 21, 0),
    membersCount: 604,
    posts: {
      'msg:218': { views: 0, forwards: 0, reactions: 0, replies: 0 },
      'msg:215': { views: 400, forwards: 4, reactions: 18, replies: 3 },
      'msg:211': { views: 386, forwards: 0, reactions: 15, replies: 4 },
      'album:662109445': { views: 949, forwards: 25, reactions: 72, replies: 11 },
      'msg:182': { views: 826, forwards: 15, reactions: 29, replies: 7 },
    },
  };

  const withDeltas = computeSnapshotDeltas(grouped, prevSnapshot);
  const {
    postStatsByPost,
    publicForwardsByPost,
    enrichedPosts,
    channelDailyViews,
    channelDailyShares,
  } = buildPostStatsMap(withDeltas, CHANNEL_2_SEEDS, Date.UTC(2026, 9, 24, 16, 45));

  return {
    channel: SAMPLE_CHANNELS[1],
    overview: {
      periodFrom: DATES_10D[0],
      periodTo: DATES_10D[DATES_10D.length - 1],
      followers: { current: 620, previous: 576 },
      viewsPerPost: { current: 445, previous: 380 },
      sharesPerPost: { current: 6.2, previous: 4.4 },
      reactionsPerPost: { current: 21.5, previous: 16.0 },
      enabledNotificationsPercent: 67.5,
      recentPostIds: Array.from(recentIds),
      interactionsGraph: parseTelegramStatsGraph(
        'interactions-2',
        'Interactions',
        buildGraphJson(DATES_10D, [
          { key: 'y0', name: 'Views', color: '#45d168', type: 'line', values: channelDailyViews },
          { key: 'y1', name: 'Shares', color: '#f5a623', type: 'line', values: channelDailyShares },
        ]),
      ),
      growthGraph: parseTelegramStatsGraph(
        'growth-2',
        'Growth',
        buildGraphJson(DATES_10D, [
          {
            key: 'y0',
            name: 'Subscribers',
            color: '#2aabee',
            type: 'line',
            values: [576, 581, 585, 589, 593, 601, 605, 610, 614, 620],
          },
        ]),
      ),
      followersGraph: parseTelegramStatsGraph(
        'followers-2',
        'Followers',
        buildGraphJson(DATES_10D, [
          { key: 'y0', name: 'Joined', color: '#45d168', type: 'bar', values: [6, 6, 5, 5, 5, 10, 6, 7, 5, 8] },
          { key: 'y1', name: 'Left', color: '#ef5a5a', type: 'bar', values: [1, 1, 1, 1, 1, 2, 2, 2, 1, 2] },
        ]),
      ),
      topHoursGraph: parseTelegramStatsGraph(
        'topHours-2',
        'Top Hours',
        buildGraphJson(HOURS_24, [
          {
            key: 'y0',
            name: 'This week',
            color: '#2aabee',
            type: 'line',
            values: [32, 18, 10, 6, 5, 9, 24, 48, 86, 120, 145, 160, 175, 168, 192, 218, 250, 290, 315, 298, 245, 190, 118, 64],
          },
        ]),
      ),
      viewsBySourceGraph: parseTelegramStatsGraph(
        'viewsBySource-2',
        'Views by Source',
        buildGraphJson(DATES_10D, [
          { key: 'y0', name: 'Followers', color: '#2aabee', type: 'area', values: [35, 30, 29, 28, 24, 310, 74, 300, 78, 360] },
          { key: 'y1', name: 'Forwards & Channels', color: '#45d168', type: 'area', values: [10, 9, 10, 8, 8, 124, 26, 110, 22, 145] },
          { key: 'y2', name: 'Search & Links', color: '#f5a623', type: 'area', values: [5, 5, 5, 5, 4, 50, 16, 68, 13, 84] },
        ]),
      ),
      languagesGraph: parseTelegramStatsGraph(
        'languages-2',
        'Languages',
        buildGraphJson([DATES_10D[DATES_10D.length - 1]], [
          { key: 'y0', name: 'Persian (fa)', color: '#2aabee', type: 'area', values: [81] },
          { key: 'y1', name: 'English (en)', color: '#45d168', type: 'area', values: [15] },
          { key: 'y2', name: 'Other', color: '#f5a623', type: 'area', values: [4] },
        ]),
      ),
    },
    posts: enrichedPosts,
    dailyDeltas: [
      {
        dateKey: formatDateKey(DATES_10D[9]),
        postKey: 'msg:218',
        primaryId: 218,
        deltaShares: 9,
        deltaViews: 510,
      },
    ],
    publicForwardsByPost,
    postStatsByPost,
    lastSnapshotAt: prevSnapshot.capturedAt,
    scanStatus: {
      scannedCount: CHANNEL_2_MESSAGES.length,
      attributedPostsCount: Object.keys(postStatsByPost).length,
      isComplete: true,
    },
  };
}

let cachedSampleDataset: {
  channels: ChannelSummary[];
  bundles: Record<number, ChannelAnalyticsBundle>;
} | null = null;

export function getSampleDataset(): {
  channels: ChannelSummary[];
  bundles: Record<number, ChannelAnalyticsBundle>;
} {
  if (!cachedSampleDataset) {
    const b1 = createChannel1Bundle();
    const b2 = createChannel2Bundle();
    cachedSampleDataset = {
      channels: SAMPLE_CHANNELS,
      bundles: {
        [b1.channel.id]: b1,
        [b2.channel.id]: b2,
      },
    };
  }
  return cachedSampleDataset;
}

export { computeFormatInsights };
