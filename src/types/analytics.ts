export type LanguageCode = 'fa' | 'en';

export type NetworkMode = 'direct' | 'socks5-bridge' | 'cf-relay';
export type TimezoneMode = 'iran' | 'local' | 'utc';

export interface Socks5BridgeConfig {
  bridgeUrl: string;
  host: string;
  port: number;
  username: string;
  password: string;
  bridgeToken?: string;
}

export interface NetworkConfig {
  mode: NetworkMode;
  socks5: Socks5BridgeConfig;
  cfRelayUrl: string;
  cfRelayToken?: string;
}

export interface ApiCredentials {
  apiId: number;
  apiHash: string;
}

export type SessionPersistenceMode = 'ephemeral' | 'vault';

export type AuthStep =
  | 'idle'
  | 'connecting'
  | 'qr_ready'
  | 'qr_scanned'
  | 'code_sent'
  | 'password_needed'
  | 'authorized';

export interface TelegramUserSummary {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

export interface ChannelSummary {
  id: number;
  title: string;
  username?: string;
  membersCount: number;
  isCreator: boolean;
  isAdmin: boolean;
  canViewStats: boolean;
  statsDc?: number;
  lastSyncedAt?: number;
  avatarColor: string;
  avatarUrl?: string;
}

export interface StatsSeriesLine {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface ParsedStatsGraph {
  id: string;
  title: string;
  type: 'line' | 'bar' | 'stacked_bar' | 'step' | 'pie';
  timestamps: number[]; // unix ms
  series: StatsSeriesLine[];
  yScaled?: boolean;
  error?: string;
}

export interface KpiMetric {
  current: number;
  previous: number;
}

export interface ReactionCount {
  emoji: string;
  count: number;
}

export type MediaKind = 'text' | 'photo' | 'video' | 'audio' | 'document' | 'poll' | 'album';

export interface PollOptionSummary {
  text: string;
  voters: number;
  chosen?: boolean;
}

export interface PostMediaMeta {
  title?: string;
  performer?: string;
  durationSec?: number;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  isVoice?: boolean;
  isAnimation?: boolean;
  isRound?: boolean;
  pollQuestion?: string;
  pollVoters?: number;
  pollIsQuiz?: boolean;
  pollIsClosed?: boolean;
  pollOptions?: PollOptionSummary[];
  webPageSite?: string;
  webPageUrl?: string;
  thumbUrl?: string;
}

export interface PostMediaPreviewItem {
  messageId: number;
  mediaKind: Exclude<MediaKind, 'album'>;
  previewUrl?: string;
  meta?: PostMediaMeta;
}

export interface PostMediaPreview {
  postKey: string;
  items: PostMediaPreviewItem[];
  loadedAt: number;
}

export interface RawChannelMessage {
  id: number;
  date: number; // unix ms
  text: string;
  views: number;
  forwards: number;
  replies: number;
  groupedId: string | null;
  mediaKind: Exclude<MediaKind, 'album'>;
  mediaMeta?: PostMediaMeta;
  reactions: ReactionCount[];
  permalink?: string;
}

export interface AlbumChildItem {
  id: number;
  mediaKind: Exclude<MediaKind, 'album'>;
  views: number;
  forwards: number;
  caption?: string;
  mediaMeta?: PostMediaMeta;
}

export interface MessageDailyActivity {
  dateKey: string; // YYYY-MM-DD UTC
  views: number;
  shares: number;
}

export interface PostRecord {
  key: string; // groupedId ? `album:${groupedId}` : `msg:${id}`
  primaryId: number;
  messageIds: number[];
  groupedId: string | null;
  isAlbum: boolean;
  albumChildren: AlbumChildItem[];
  date: number; // unix ms
  text: string;
  mediaKind: MediaKind;
  mediaMeta?: PostMediaMeta;
  views: number;
  forwards: number;
  albumTotalItemForwards: number;
  publicSharesCount: number;
  privateSharesCount: number;
  replies: number;
  reactionsCount: number;
  reactions: ReactionCount[];
  shareRatePercent: number; // forwards / views * 100
  engagementRatePercent: number;
  deltaViews: number;
  deltaShares: number;
  deltaReactions: number;
  evergreenShareRatio: number; // % of shares/views gained > 48h after publish
  permalink?: string;
  inRecentWindow?: boolean;
}

export interface PublicForwardRecord {
  channelId: number;
  channelTitle: string;
  channelUsername?: string;
  messageId: number;
  date: number; // unix ms
  views: number;
}

export interface PostDetailedStats {
  postKey: string;
  primaryId: number;
  viewsGraph?: ParsedStatsGraph;
  reactionsGraph?: ParsedStatsGraph;
  dailyBreakdown: MessageDailyActivity[];
  publicForwards: PublicForwardRecord[];
  publicSharesTotal?: number;
  loadedAt: number;
}

export interface ChannelSnapshot {
  channelId: number;
  capturedAt: number;
  membersCount: number;
  posts: Record<
    string,
    {
      views: number;
      forwards: number;
      reactions: number;
      replies: number;
    }
  >;
}

export interface DailyDeltaRecord {
  dateKey: string;
  postKey: string;
  primaryId: number;
  deltaShares: number;
  deltaViews: number;
}

export interface BroadcastOverviewStats {
  periodFrom: number;
  periodTo: number;
  followers: KpiMetric;
  viewsPerPost: KpiMetric;
  sharesPerPost: KpiMetric;
  reactionsPerPost: KpiMetric;
  enabledNotificationsPercent: number;
  recentPostIds: number[];
  growthGraph?: ParsedStatsGraph;
  followersGraph?: ParsedStatsGraph;
  muteGraph?: ParsedStatsGraph;
  topHoursGraph?: ParsedStatsGraph;
  interactionsGraph?: ParsedStatsGraph;
  viewsBySourceGraph?: ParsedStatsGraph;
  newFollowersBySourceGraph?: ParsedStatsGraph;
  languagesGraph?: ParsedStatsGraph;
  reactionsByEmotionGraph?: ParsedStatsGraph;
}

export interface ChannelAnalyticsBundle {
  channel: ChannelSummary;
  overview: BroadcastOverviewStats;
  posts: PostRecord[];
  dailyDeltas: DailyDeltaRecord[];
  publicForwardsByPost: Record<string, PublicForwardRecord[]>;
  postStatsByPost: Record<string, PostDetailedStats>;
  lastSnapshotAt: number | null;
  scanStatus: {
    scannedCount: number;
    attributedPostsCount: number;
    isComplete: boolean;
  };
}

export type PostFilterMode = 'all' | 'has_shares' | 'evergreen' | 'albums' | 'older_than_7d';
export type PostSortBy = 'date_desc' | 'shares_desc' | 'delta_desc' | 'share_rate_desc' | 'views_desc' | 'evergreen_desc' | 'reactions_desc';

export interface AttributedPostContribution {
  post: PostRecord;
  viewsOnDate: number;
  sharesOnDate: number;
  shareContributionPct: number;
  viewContributionPct: number;
  source: 'message_stats' | 'snapshot_delta' | 'public_forward';
}

export interface DateAttributionResult {
  dateKey: string;
  graphTotalViews: number;
  graphTotalShares: number;
  attributedViewsSum: number;
  attributedSharesSum: number;
  recentPostsSharesSum: number;
  unattributedShares: number;
  contributions: AttributedPostContribution[];
  publicForwardsOnDate: Array<{
    post: PostRecord;
    forward: PublicForwardRecord;
  }>;
}

export interface ChannelBenchmarks {
  medianViews: number;
  p90Views: number;
  medianShareRate: number;
  evergreenSharePercent: number;
  totalPublicShares: number;
  totalPrivateShares: number;
}

export interface FormatInsight {
  mediaKind: MediaKind;
  postCount: number;
  avgViews: number;
  avgShares: number;
  avgShareRate: number;
}

export interface WeekdayHourCell {
  weekday: number; // 0=Sun..6=Sat
  hourBlock: number; // 0..5 (4h blocks)
  postCount: number;
  avgShareRate: number;
  avgViews: number;
}
