import type {
  AlbumChildItem,
  AttributedPostContribution,
  ChannelBenchmarks,
  ChannelSnapshot,
  DailyDeltaRecord,
  DateAttributionResult,
  FormatInsight,
  LanguageCode,
  MediaKind,
  MessageDailyActivity,
  ParsedStatsGraph,
  PostDetailedStats,
  PostFilterMode,
  PostMediaMeta,
  PostRecord,
  PostSortBy,
  PublicForwardRecord,
  RawChannelMessage,
  StatsSeriesLine,
  TimezoneMode,
  WeekdayHourCell,
} from '../types/analytics';

export function formatDateKey(unixMs: number): string {
  const d = new Date(unixMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Extracts exact daily Views & Shares rows from a message's `stats.getMessageStats` graph.
 */
export function extractDailyActivityFromGraph(
  graph?: ParsedStatsGraph,
  postDateMs?: number,
): MessageDailyActivity[] {
  if (!graph || graph.timestamps.length === 0) return [];
  const viewsSeries =
    graph.series.find((s) => /view/i.test(s.label) || s.key === 'y0') ?? graph.series[0];
  const sharesSeries =
    graph.series.find((s) => /share|forward/i.test(s.label) || s.key === 'y1') ??
    (graph.series.length > 1 ? graph.series[1] : undefined);

  const rawViews = viewsSeries?.values ?? [];
  const rawShares = sharesSeries?.values ?? [];

  const firstGraphDateKey = formatDateKey(graph.timestamps[0]);
  const postPublishedBeforeFirstGraphPoint =
    typeof postDateMs === 'number' && formatDateKey(postDateMs) < firstGraphDateKey;

  // Detect whether views are cumulative (running total that never decreases)
  let isCumulative = false;
  if (rawViews.length >= 2) {
    let nonDecreasingCount = 0;
    for (let i = 1; i < rawViews.length; i += 1) {
      if (rawViews[i] >= rawViews[i - 1]) nonDecreasingCount += 1;
    }
    if (nonDecreasingCount >= (rawViews.length - 1) * 0.95 && rawViews[rawViews.length - 1] > 0) {
      isCumulative = true;
    }
  } else if (rawViews.length === 1 && postPublishedBeforeFirstGraphPoint) {
    isCumulative = true;
  }

  const dailyMap = new Map<string, { views: number; shares: number }>();

  for (let i = 0; i < graph.timestamps.length; i += 1) {
    const ts = graph.timestamps[i];
    const dateKey = formatDateKey(ts);

    let v = Math.max(0, rawViews[i] ?? 0);
    if (isCumulative) {
      if (i === 0) {
        // If the post was published BEFORE the graph starts, index 0 is baseline carryover from prior days!
        v = postPublishedBeforeFirstGraphPoint ? 0 : v;
      } else {
        const prev = Math.max(0, rawViews[i - 1] ?? 0);
        v = Math.max(0, v - prev);
      }
    }
    const s = Math.max(0, rawShares[i] ?? 0);

    const existing = dailyMap.get(dateKey);
    if (existing) {
      existing.views += v;
      existing.shares += s;
    } else {
      dailyMap.set(dateKey, { views: v, shares: s });
    }
  }

  return Array.from(dailyMap.entries()).map(([dateKey, stats]) => ({
    dateKey,
    views: stats.views,
    shares: stats.shares,
  }));
}

export function computeEvergreenRatio(postDateMs: number, daily: MessageDailyActivity[]): number {
  if (daily.length === 0) return 0;
  const cutoffMs = postDateMs + 48 * 3600_000;
  let totalWeight = 0;
  let longTailWeight = 0;

  for (const row of daily) {
    const rowMs = Date.parse(`${row.dateKey}T12:00:00Z`);
    const weight = row.shares * 10 + row.views;
    totalWeight += weight;
    if (rowMs > cutoffMs) {
      longTailWeight += weight;
    }
  }
  if (totalWeight <= 0) return 0;
  return Math.round((longTailWeight / totalWeight) * 100);
}

/**
 * Groups Telegram messages sharing `groupedId` into unified album posts,
 * while preserving individual child `views` and `forwards`.
 */
export function groupAlbumPosts(
  rawMessages: RawChannelMessage[],
  recentPostIds: Set<number> = new Set(),
): PostRecord[] {
  const ordered = [...rawMessages].sort((a, b) => b.date - a.date || b.id - a.id);
  const albumMap = new Map<string, RawChannelMessage[]>();
  const resultOrder: Array<{ kind: 'single'; msg: RawChannelMessage } | { kind: 'album'; groupId: string }> = [];
  const seenGroups = new Set<string>();

  for (const msg of ordered) {
    if (msg.groupedId) {
      const existing = albumMap.get(msg.groupedId);
      if (existing) existing.push(msg);
      else albumMap.set(msg.groupedId, [msg]);
      if (!seenGroups.has(msg.groupedId)) {
        seenGroups.add(msg.groupedId);
        resultOrder.push({ kind: 'album', groupId: msg.groupedId });
      }
    } else {
      resultOrder.push({ kind: 'single', msg });
    }
  }

  const posts: PostRecord[] = [];

  for (const entry of resultOrder) {
    if (entry.kind === 'single') {
      const msg = entry.msg;
      const reactionsCount = msg.reactions.reduce((sum, r) => sum + r.count, 0);
      const views = Math.max(0, msg.views);
      const forwards = Math.max(0, msg.forwards);
      const shareRatePercent = views > 0 ? Number(((forwards / views) * 100).toFixed(2)) : 0;
      const engagementRatePercent =
        views > 0 ? Number((((forwards + reactionsCount + msg.replies) / views) * 100).toFixed(2)) : 0;

      posts.push({
        key: `msg:${msg.id}`,
        primaryId: msg.id,
        messageIds: [msg.id],
        groupedId: null,
        isAlbum: false,
        albumChildren: [],
        date: msg.date,
        text: msg.text,
        mediaKind: msg.mediaKind,
        mediaMeta: msg.mediaMeta,
        views,
        forwards,
        albumTotalItemForwards: forwards,
        publicSharesCount: 0,
        privateSharesCount: forwards,
        replies: msg.replies,
        reactionsCount,
        reactions: msg.reactions,
        shareRatePercent,
        engagementRatePercent,
        deltaViews: 0,
        deltaShares: 0,
        deltaReactions: 0,
        evergreenShareRatio: 0,
        permalink: msg.permalink,
        inRecentWindow: recentPostIds.has(msg.id),
      });
    } else {
      const items = albumMap.get(entry.groupId)!;
      const sortedItems = [...items].sort((a, b) => a.id - b.id);
      const primary = sortedItems.find((i) => i.text.trim().length > 0) ?? sortedItems[0];

      const children: AlbumChildItem[] = sortedItems.map((item) => ({
        id: item.id,
        mediaKind: item.mediaKind,
        views: Math.max(0, item.views),
        forwards: Math.max(0, item.forwards),
        caption: item.text.trim() || undefined,
        mediaMeta: item.mediaMeta,
      }));

      const primaryMediaMeta: PostMediaMeta | undefined =
        primary.mediaMeta ?? sortedItems.find((i) => Boolean(i.mediaMeta))?.mediaMeta;

      const views = Math.max(...sortedItems.map((i) => Math.max(0, i.views)));
      const maxForwards = Math.max(...sortedItems.map((i) => Math.max(0, i.forwards)));
      const sumForwards = sortedItems.reduce((acc, i) => acc + Math.max(0, i.forwards), 0);
      const replies = Math.max(...sortedItems.map((i) => Math.max(0, i.replies)));

      const reactionTotals = new Map<string, number>();
      for (const item of sortedItems) {
        for (const r of item.reactions) {
          reactionTotals.set(r.emoji, Math.max(reactionTotals.get(r.emoji) ?? 0, r.count));
        }
      }
      const mergedReactions = Array.from(reactionTotals.entries()).map(([emoji, count]) => ({
        emoji,
        count,
      }));
      const reactionsCount = mergedReactions.reduce((sum, r) => sum + r.count, 0);

      const shareRatePercent = views > 0 ? Number(((maxForwards / views) * 100).toFixed(2)) : 0;
      const engagementRatePercent =
        views > 0 ? Number((((maxForwards + reactionsCount + replies) / views) * 100).toFixed(2)) : 0;

      posts.push({
        key: `album:${entry.groupId}`,
        primaryId: primary.id,
        messageIds: sortedItems.map((i) => i.id),
        groupedId: entry.groupId,
        isAlbum: true,
        albumChildren: children,
        date: primary.date,
        text: primary.text || `Media Album (${sortedItems.length} items)`,
        mediaKind: 'album',
        mediaMeta: primaryMediaMeta,
        views,
        forwards: maxForwards,
        albumTotalItemForwards: sumForwards,
        publicSharesCount: 0,
        privateSharesCount: maxForwards,
        replies,
        reactionsCount,
        reactions: mergedReactions,
        shareRatePercent,
        engagementRatePercent,
        deltaViews: 0,
        deltaShares: 0,
        deltaReactions: 0,
        evergreenShareRatio: 0,
        permalink: primary.permalink,
        inRecentWindow: sortedItems.some((i) => recentPostIds.has(i.id)),
      });
    }
  }

  return posts.sort((a, b) => b.date - a.date || b.primaryId - a.primaryId);
}

export function computeSnapshotDeltas(
  posts: PostRecord[],
  previousSnapshot: ChannelSnapshot | null,
): PostRecord[] {
  if (!previousSnapshot) return posts;

  return posts.map((post) => {
    const prev = previousSnapshot.posts[post.key];
    if (!prev) {
      // Only attribute lifetime numbers as deltas if this post was published AFTER the previous snapshot was taken.
      // If the post was published BEFORE the previous snapshot, it is an older post not included in that snapshot;
      // its historical views/shares did NOT occur in the current window!
      const isNewPost = post.date >= previousSnapshot.capturedAt;
      return {
        ...post,
        deltaViews: isNewPost ? post.views : 0,
        deltaShares: isNewPost ? post.forwards : 0,
        deltaReactions: isNewPost ? post.reactionsCount : 0,
      };
    }

    return {
      ...post,
      deltaViews: Math.max(0, post.views - prev.views),
      deltaShares: Math.max(0, post.forwards - prev.forwards),
      deltaReactions: Math.max(0, post.reactionsCount - prev.reactions),
    };
  });
}

export function buildSnapshotFromPosts(
  channelId: number,
  membersCount: number,
  posts: PostRecord[],
  capturedAt: number = Date.now(),
): ChannelSnapshot {
  const map: ChannelSnapshot['posts'] = {};
  for (const post of posts) {
    map[post.key] = {
      views: post.views,
      forwards: post.forwards,
      reactions: post.reactionsCount,
      replies: post.replies,
    };
  }
  return {
    channelId,
    capturedAt,
    membersCount,
    posts: map,
  };
}

/**
 * Exact Per-Date Post Attribution Engine:
 * Combines Telegram's `stats.getMessageStats` daily timeline (`views` + `shares` per message),
 * snapshot deltas, and `stats.getMessagePublicForwards` to pinpoint exactly WHICH posts
 * generated a given date's Views and Shares.
 */
export function attributeDateFromMessageStats(params: {
  dateKey: string;
  interactionsGraph?: ParsedStatsGraph;
  posts: PostRecord[];
  postStatsByPost: Record<string, PostDetailedStats>;
  dailyDeltas: DailyDeltaRecord[];
  publicForwardsByPost: Record<string, PublicForwardRecord[]>;
}): DateAttributionResult {
  const {
    dateKey,
    interactionsGraph,
    posts,
    postStatsByPost,
    dailyDeltas,
    publicForwardsByPost,
  } = params;

  let graphTotalViews = 0;
  let graphTotalShares = 0;

  if (interactionsGraph) {
    const dayIndex = interactionsGraph.timestamps.findIndex((ts) => formatDateKey(ts) === dateKey);
    if (dayIndex !== -1) {
      const viewsSeries =
        interactionsGraph.series.find((s) => /view/i.test(s.label) || s.key === 'y0') ??
        interactionsGraph.series[0];
      const shareSeries =
        interactionsGraph.series.find((s) => /share|forward/i.test(s.label) || s.key === 'y1') ??
        interactionsGraph.series[1];
      graphTotalViews = viewsSeries?.values[dayIndex] ?? 0;
      graphTotalShares = shareSeries?.values[dayIndex] ?? 0;
    }
  }

  const recentPostsSharesSum = posts
    .filter((p) => p.inRecentWindow && formatDateKey(p.date) === dateKey)
    .reduce((sum, p) => sum + p.forwards, 0);

  const contributionMap = new Map<string, AttributedPostContribution>();

  // 1) Primary source: per-message `stats.getMessageStats` daily breakdown (has BOTH views & shares!)
  for (const post of posts) {
    const detailed = postStatsByPost[post.key];
    if (!detailed) continue;
    const dailyBreakdown =
      detailed.dailyBreakdown.length > 0
        ? detailed.dailyBreakdown
        : detailed.viewsGraph
          ? extractDailyActivityFromGraph(detailed.viewsGraph, post.date)
          : [];
    const dayRow = dailyBreakdown.find((d) => d.dateKey === dateKey);
    if (!dayRow || (dayRow.views <= 0 && dayRow.shares <= 0)) continue;

    // Any post published before this date MUST have shares on this date to be attributed!
    // Older posts with 0 shares on this date are baseline carryover / historical views and do not belong in this date's ledger.
    const isOldPost = formatDateKey(post.date) < dateKey;
    if (isOldPost && dayRow.shares === 0) {
      continue;
    }

    contributionMap.set(post.key, {
      post,
      viewsOnDate: dayRow.views,
      sharesOnDate: dayRow.shares,
      shareContributionPct: 0,
      viewContributionPct: 0,
      source: 'message_stats',
    });
  }

  // 2) Secondary source: local snapshot deltas for any post
  const postByKey = new Map(posts.map((p) => [p.key, p]));
  for (const d of dailyDeltas) {
    if (d.dateKey !== dateKey) continue;
    const post = postByKey.get(d.postKey);
    if (!post) continue;

    // Discard corrupted historical deltas where an older post (published >48h before delta date)
    // was attributed lifetime forwards due to a missing baseline in older versions
    const deltaEndMs = Date.parse(`${d.dateKey}T23:59:59.999Z`);
    if (deltaEndMs - post.date > 48 * 3600_000 && d.deltaShares >= post.forwards && post.forwards > 0) {
      continue;
    }

    // Older posts must have positive deltaShares on this date to be attributed
    const isOldPost = formatDateKey(post.date) < dateKey;
    if (isOldPost && d.deltaShares <= 0) {
      continue;
    }

    const existing = contributionMap.get(d.postKey);
    if (existing) {
      if (existing.viewsOnDate === 0 && d.deltaViews > 0) existing.viewsOnDate = d.deltaViews;
      if (existing.sharesOnDate === 0 && d.deltaShares > 0) existing.sharesOnDate = d.deltaShares;
    } else {
      if (d.deltaShares <= 0 && d.deltaViews <= 0) continue;
      contributionMap.set(d.postKey, {
        post,
        viewsOnDate: Math.max(0, d.deltaViews),
        sharesOnDate: Math.max(0, d.deltaShares),
        shareContributionPct: 0,
        viewContributionPct: 0,
        source: 'snapshot_delta',
      });
    }
  }

  // 3) Public channel forwards on this date (always increment shares even if post exists)
  const publicForwardsOnDate: Array<{ post: PostRecord; forward: PublicForwardRecord }> = [];
  for (const [postKey, forwards] of Object.entries(publicForwardsByPost)) {
    const post = postByKey.get(postKey);
    if (!post) continue;
    for (const fwd of forwards) {
      if (formatDateKey(fwd.date) === dateKey) {
        publicForwardsOnDate.push({ post, forward: fwd });
        const existing = contributionMap.get(postKey);
        if (existing) {
          // message_stats already includes both public & private shares; avoid double-counting
          if (existing.source !== 'message_stats') {
            existing.sharesOnDate += 1;
          }
        } else {
          contributionMap.set(postKey, {
            post,
            viewsOnDate: 0,
            sharesOnDate: 1,
            shareContributionPct: 0,
            viewContributionPct: 0,
            source: 'public_forward',
          });
        }
      }
    }
  }

  // 4) Fallback attribution for unscanned posts published strictly on this UTC date
  for (const post of posts) {
    if (post.views <= 0 && post.forwards <= 0) continue;
    if (formatDateKey(post.date) !== dateKey) continue;
    if (postStatsByPost[post.key]) continue;

    const existing = contributionMap.get(post.key);
    if (!existing) {
      contributionMap.set(post.key, {
        post,
        viewsOnDate: post.views,
        sharesOnDate: post.forwards,
        shareContributionPct: 0,
        viewContributionPct: 0,
        source: 'message_stats',
      });
    } else {
      if (existing.viewsOnDate === 0 && post.views > 0) {
        existing.viewsOnDate = post.views;
      }
      if (existing.sharesOnDate === 0 && post.forwards > 0) {
        existing.sharesOnDate = post.forwards;
      }
    }
  }

  const contributions = Array.from(contributionMap.values()).sort(
    (a, b) => b.sharesOnDate - a.sharesOnDate || b.viewsOnDate - a.viewsOnDate,
  );

  const attributedViewsSum = contributions.reduce((s, c) => s + c.viewsOnDate, 0);
  const attributedSharesSum = contributions.reduce((s, c) => s + c.sharesOnDate, 0);

  const shareDenom = Math.max(1, graphTotalShares || attributedSharesSum);
  const viewDenom = Math.max(1, graphTotalViews || attributedViewsSum);

  for (const item of contributions) {
    item.shareContributionPct = Math.min(100, Math.round((item.sharesOnDate / shareDenom) * 100));
    item.viewContributionPct = Math.min(100, Math.round((item.viewsOnDate / viewDenom) * 100));
  }

  return {
    dateKey,
    graphTotalViews,
    graphTotalShares,
    attributedViewsSum,
    attributedSharesSum,
    recentPostsSharesSum,
    unattributedShares: Math.max(0, graphTotalShares - attributedSharesSum),
    contributions,
    publicForwardsOnDate,
  };
}

export function computeChannelBenchmarks(posts: PostRecord[]): ChannelBenchmarks {
  if (posts.length === 0) {
    return {
      medianViews: 0,
      p90Views: 0,
      medianShareRate: 0,
      evergreenSharePercent: 0,
      totalPublicShares: 0,
      totalPrivateShares: 0,
    };
  }

  const sortedViews = [...posts].map((p) => p.views).sort((a, b) => a - b);
  const sortedRates = [...posts].map((p) => p.shareRatePercent).sort((a, b) => a - b);

  const mid = Math.floor(sortedViews.length / 2);
  const medianViews =
    sortedViews.length % 2 === 0
      ? Math.round((sortedViews[mid - 1] + sortedViews[mid]) / 2)
      : sortedViews[mid];

  const p90Idx = Math.min(sortedViews.length - 1, Math.floor(sortedViews.length * 0.9));
  const p90Views = sortedViews[p90Idx];

  const medianShareRate =
    sortedRates.length % 2 === 0
      ? Number(((sortedRates[mid - 1] + sortedRates[mid]) / 2).toFixed(2))
      : sortedRates[mid];

  const totalShares = posts.reduce((s, p) => s + p.forwards, 0);
  const totalPublicShares = posts.reduce((s, p) => s + p.publicSharesCount, 0);
  const totalPrivateShares = Math.max(0, totalShares - totalPublicShares);

  const latestDate = posts.reduce((max, p) => (p.date > max ? p.date : max), 0);
  const olderShares = posts
    .filter((p) => latestDate - p.date > 7 * 86400_000)
    .reduce((s, p) => s + p.forwards, 0);
  const evergreenSharePercent =
    totalShares > 0 ? Math.round((olderShares / totalShares) * 100) : 0;

  return {
    medianViews,
    p90Views,
    medianShareRate,
    evergreenSharePercent,
    totalPublicShares,
    totalPrivateShares,
  };
}

export function getTimezoneOffsetMinutes(mode: TimezoneMode): number {
  if (mode === 'iran') return 210; // UTC+03:30
  if (mode === 'local' && typeof Date !== 'undefined') {
    return -new Date().getTimezoneOffset();
  }
  return 0;
}

export function getTimezoneBadgeLabel(mode: TimezoneMode): string {
  const mins = getTimezoneOffsetMinutes(mode);
  if (mins === 0) return 'UTC';
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

export function computeWeekdayHourMatrix(
  posts: PostRecord[],
  timezoneOffsetMinutes = 0,
): WeekdayHourCell[] {
  const buckets = new Map<string, PostRecord[]>();
  const offsetMs = timezoneOffsetMinutes * 60_000;
  for (const post of posts) {
    const d = new Date(post.date + offsetMs);
    const weekday = d.getUTCDay();
    const hourBlock = Math.floor(d.getUTCHours() / 4); // 6 blocks of 4h
    const key = `${weekday}:${hourBlock}`;
    const arr = buckets.get(key);
    if (arr) arr.push(post);
    else buckets.set(key, [post]);
  }

  const cells: WeekdayHourCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hourBlock = 0; hourBlock < 6; hourBlock += 1) {
      const items = buckets.get(`${weekday}:${hourBlock}`) ?? [];
      const postCount = items.length;
      const avgViews =
        postCount > 0 ? Math.round(items.reduce((s, i) => s + i.views, 0) / postCount) : 0;
      const avgShareRate =
        postCount > 0
          ? Number((items.reduce((s, i) => s + i.shareRatePercent, 0) / postCount).toFixed(2))
          : 0;
      cells.push({ weekday, hourBlock, postCount, avgShareRate, avgViews });
    }
  }
  return cells;
}

export function parseTelegramStatsGraph(id: string, title: string, rawJson: string): ParsedStatsGraph {
  try {
    const parsed = JSON.parse(rawJson) as {
      columns?: Array<[string, ...Array<number | string>]>;
      types?: Record<string, string>;
      names?: Record<string, string>;
      colors?: Record<string, string>;
      y_scaled?: boolean;
    };

    const columns = parsed.columns ?? [];
    const xCol = columns.find((col) => col[0] === 'x' || parsed.types?.[col[0]] === 'x');
    if (!xCol) {
      return { id, title, type: 'line', timestamps: [], series: [], yScaled: Boolean(parsed.y_scaled) };
    }

    const timestamps = xCol.slice(1).map((val) => Number(val));
    const types = parsed.types ?? {};
    const names = parsed.names ?? {};
    const colors = parsed.colors ?? {};

    let graphType: ParsedStatsGraph['type'] = 'line';
    const series: StatsSeriesLine[] = [];

    for (const col of columns) {
      const key = col[0];
      if (key === xCol[0]) continue;
      const colType = types[key];
      if (colType === 'bar') graphType = 'bar';
      if (colType === 'area') graphType = 'stacked_bar';
      if (colType === 'step') graphType = 'step';

      const rawColor = colors[key] ?? '#2aabee';
      const hexMatch = rawColor.match(/#[0-9a-fA-F]{3,8}/);
      const cleanColor = hexMatch ? hexMatch[0] : '#2aabee';

      series.push({
        key,
        label: names[key] ?? key,
        color: cleanColor,
        values: col.slice(1).map((v) => Number(v) || 0),
      });
    }

    return {
      id,
      title,
      type: graphType,
      timestamps,
      series,
      yScaled: Boolean(parsed.y_scaled),
    };
  } catch (err) {
    return {
      id,
      title,
      type: 'line',
      timestamps: [],
      series: [],
      error: err instanceof Error ? err.message : 'Invalid graph JSON',
    };
  }
}

export function filterAndSortPosts(
  posts: PostRecord[],
  query: string,
  filterMode: PostFilterMode,
  sortBy: PostSortBy,
  referenceNowMs: number = Date.now(),
): PostRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const filtered = posts.filter((post) => {
    if (normalizedQuery) {
      const idMatch = String(post.primaryId).includes(normalizedQuery);
      const textMatch = post.text.toLowerCase().includes(normalizedQuery);
      if (!idMatch && !textMatch) return false;
    }

    switch (filterMode) {
      case 'has_shares':
        return post.forwards > 0;
      case 'evergreen':
        return post.evergreenShareRatio >= 25 || (referenceNowMs - post.date > sevenDaysMs && post.forwards > 0);
      case 'albums':
        return post.isAlbum;
      case 'older_than_7d':
        return referenceNowMs - post.date > sevenDaysMs && post.forwards > 0;
      case 'all':
      default:
        return true;
    }
  });

  return filtered.sort((a, b) => {
    switch (sortBy) {
      case 'shares_desc':
        return b.forwards - a.forwards || b.views - a.views;
      case 'delta_desc':
        return b.deltaShares - a.deltaShares || b.forwards - a.forwards;
      case 'share_rate_desc':
        return b.shareRatePercent - a.shareRatePercent || b.forwards - a.forwards;
      case 'views_desc':
        return b.views - a.views;
      case 'evergreen_desc':
        return b.evergreenShareRatio - a.evergreenShareRatio || b.forwards - a.forwards;
      case 'reactions_desc':
        return b.reactionsCount - a.reactionsCount || b.views - a.views;
      case 'date_desc':
      default:
        return b.date - a.date || b.primaryId - a.primaryId;
    }
  });
}

export function computeFormatInsights(posts: PostRecord[]): FormatInsight[] {
  const groups = new Map<MediaKind, PostRecord[]>();
  for (const post of posts) {
    const arr = groups.get(post.mediaKind);
    if (arr) arr.push(post);
    else groups.set(post.mediaKind, [post]);
  }

  const insights: FormatInsight[] = [];
  for (const [mediaKind, items] of groups.entries()) {
    const postCount = items.length;
    const avgViews = Math.round(items.reduce((s, i) => s + i.views, 0) / postCount);
    const avgShares = Number((items.reduce((s, i) => s + i.forwards, 0) / postCount).toFixed(1));
    const avgShareRate = Number((items.reduce((s, i) => s + i.shareRatePercent, 0) / postCount).toFixed(2));
    insights.push({ mediaKind, postCount, avgViews, avgShares, avgShareRate });
  }

  return insights.sort((a, b) => b.avgShareRate - a.avgShareRate || b.avgShares - a.avgShares);
}

function escapeCsvCell(value: string | number): string {
  let str = String(value);
  if (typeof value === 'string' && /^\s*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportPostsToCsv(posts: PostRecord[]): string {
  const header = [
    'post_id',
    'date_iso',
    'media_kind',
    'is_album',
    'views',
    'forwards_total',
    'public_shares',
    'private_shares',
    'share_rate_pct',
    'evergreen_pct',
    'reactions',
    'replies',
    'text_preview',
    'permalink',
  ];

  const rows = posts.map((p) =>
    [
      p.primaryId,
      new Date(p.date).toISOString(),
      p.mediaKind,
      p.isAlbum ? 'true' : 'false',
      p.views,
      p.forwards,
      p.publicSharesCount,
      p.privateSharesCount,
      p.shareRatePercent,
      p.evergreenShareRatio,
      p.reactionsCount,
      p.replies,
      p.text.replace(/\s+/g, ' ').slice(0, 140),
      p.permalink ?? '',
    ]
      .map(escapeCsvCell)
      .join(','),
  );

  return [header.join(','), ...rows].join('\n');
}

export function formatCompactNumber(num: number): string {
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString('en-US');
}

/**
 * Computes deduplicated integer Y-axis ticks so small series (e.g. 0..4 shares)
 * render crisp unique labels instead of repeated rounded numbers.
 */
export function computeAxisTicks(minVal: number, maxVal: number, desiredSteps = 4): number[] {
  const safeMin = Math.floor(minVal);
  const safeMax = Math.max(safeMin + 1, Math.ceil(maxVal));
  const span = safeMax - safeMin;

  if (span <= desiredSteps) {
    const ticks: number[] = [];
    for (let v = safeMin; v <= safeMax; v += 1) {
      ticks.push(v);
    }
    return ticks;
  }

  const ticks: number[] = [];
  for (let i = 0; i <= desiredSteps; i += 1) {
    const val = Math.round(safeMin + (i / desiredSteps) * span);
    if (ticks[ticks.length - 1] !== val) {
      ticks.push(val);
    }
  }
  return ticks;
}

export interface DualAxisPlan {
  isDualAxis: boolean;
  leftSeriesIndices: number[];
  rightSeriesIndices: number[];
}

function getVisibleSeriesMax(s: StatsSeriesLine, visibleIndices?: number[]): number {
  if (!visibleIndices || visibleIndices.length === 0) {
    let m = 0;
    for (const v of s.values) {
      if (v > m) m = v;
    }
    return m;
  }
  let m = 0;
  for (const idx of visibleIndices) {
    const v = s.values[idx] ?? 0;
    if (v > m) m = v;
  }
  return m;
}

/**
 * Resolves Left & Right Y-axis assignment for line/step charts.
 * Always pins Views to the Left axis and Shares/Forwards to the Right axis,
 * even when Telegram orders columns as [Shares, Views] or marks `y_scaled: true`.
 */
export function resolveDualAxisPlan(
  activeSeries: StatsSeriesLine[],
  graphType: ParsedStatsGraph['type'],
  visibleIndices?: number[],
  yScaled?: boolean,
): DualAxisPlan {
  const defaultLeft = activeSeries.map((_, idx) => idx);
  if ((graphType !== 'line' && graphType !== 'step') || activeSeries.length < 2) {
    return { isDualAxis: false, leftSeriesIndices: defaultLeft, rightSeriesIndices: [] };
  }

  const sharesIdx = activeSeries.findIndex((s) => /share|forward|بازنشر|شیر|اشتراک/i.test(s.label));
  const viewsIdx = activeSeries.findIndex((s) => /view|بازدید|ویو|نمایش/i.test(s.label));

  if (viewsIdx !== -1 && sharesIdx !== -1 && viewsIdx !== sharesIdx) {
    const leftSeriesIndices: number[] = [];
    const rightSeriesIndices: number[] = [sharesIdx];
    for (let i = 0; i < activeSeries.length; i += 1) {
      if (i !== sharesIdx) leftSeriesIndices.push(i);
    }
    return { isDualAxis: true, leftSeriesIndices, rightSeriesIndices };
  }

  const maxes = activeSeries.map((s) => getVisibleSeriesMax(s, visibleIndices));
  const high = Math.max(...maxes);
  const lowVal = Math.min(...maxes);
  const highIdx = maxes.indexOf(high);
  const lowIdx = maxes.lastIndexOf(lowVal);

  if (yScaled || high / Math.max(1, lowVal) >= 3) {
    const rightIdx = lowIdx !== highIdx ? lowIdx : activeSeries.length - 1;
    const leftSeriesIndices: number[] = [];
    for (let i = 0; i < activeSeries.length; i += 1) {
      if (i !== rightIdx) leftSeriesIndices.push(i);
    }
    return { isDualAxis: true, leftSeriesIndices, rightSeriesIndices: [rightIdx] };
  }

  return { isDualAxis: false, leftSeriesIndices: defaultLeft, rightSeriesIndices: [] };
}

/**
 * Determines whether a multi-series chart should separate Left & Right Y-axes.
 * Prevents low-volume series (like Shares) from being crushed flat along the Views 0 baseline.
 */
export function shouldUseDualAxis(
  activeSeries: StatsSeriesLine[],
  graphType: ParsedStatsGraph['type'],
  visibleIndices?: number[],
  yScaled?: boolean,
): boolean {
  return resolveDualAxisPlan(activeSeries, graphType, visibleIndices, yScaled).isDualAxis;
}

export function formatMediaDuration(seconds?: number): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '0:00';
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getPostDisplayTitle(post: PostRecord, lang: LanguageCode): string {
  const trimmed = post.text.trim();
  if (trimmed.length > 0) return trimmed;

  const meta = post.mediaMeta;
  if (post.mediaKind === 'audio') {
    if (meta?.title && meta?.performer) return `${meta.performer} — ${meta.title}`;
    if (meta?.title) return meta.title;
    if (meta?.fileName) return meta.fileName;
    if (meta?.isVoice) return lang === 'fa' ? `پیام صوتی #${post.primaryId}` : `Voice message #${post.primaryId}`;
    return lang === 'fa' ? `فایل صوتی / موزیک #${post.primaryId}` : `Audio track #${post.primaryId}`;
  }

  if (post.mediaKind === 'poll' && meta?.pollQuestion) {
    return meta.pollQuestion;
  }

  if (meta?.fileName) return meta.fileName;
  if (meta?.title) return meta.title;

  const fallbackByKind: Record<MediaKind, { fa: string; en: string }> = {
    photo: { fa: `پست تصویری #${post.primaryId}`, en: `Photo post #${post.primaryId}` },
    video: { fa: `پست ویدیویی #${post.primaryId}`, en: `Video post #${post.primaryId}` },
    audio: { fa: `موزیک #${post.primaryId}`, en: `Audio #${post.primaryId}` },
    document: { fa: `فایل #${post.primaryId}`, en: `Document #${post.primaryId}` },
    poll: { fa: `نظرسنجی #${post.primaryId}`, en: `Poll #${post.primaryId}` },
    album: { fa: `آلبوم رسانه #${post.primaryId}`, en: `Media album #${post.primaryId}` },
    text: { fa: `پست #${post.primaryId}`, en: `Post #${post.primaryId}` },
  };

  return fallbackByKind[post.mediaKind]?.[lang] ?? `#${post.primaryId}`;
}

