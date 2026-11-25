import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeDateFromMessageStats,
  buildSnapshotFromPosts,
  computeAxisTicks,
  computeChannelBenchmarks,
  computeEvergreenRatio,
  computeSnapshotDeltas,
  computeWeekdayHourMatrix,
  exportPostsToCsv,
  extractDailyActivityFromGraph,
  formatFileSize,
  formatMediaDuration,
  getPostDisplayTitle,
  groupAlbumPosts,
  parseTelegramStatsGraph,
  resolveDualAxisPlan,
  shouldUseDualAxis,
} from './analyticsMath';
import type {
  ChannelSnapshot,
  DailyDeltaRecord,
  ParsedStatsGraph,
  PostDetailedStats,
  PostRecord,
  RawChannelMessage,
} from '../types/analytics';

test('extractDailyActivityFromGraph extracts both per-message views and shares per day', () => {
  const msgJson = JSON.stringify({
    columns: [
      ['x', Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 4), Date.UTC(2026, 10, 9)],
      ['y0', 12, 1, 4],
      ['y1', 1, 0, 2],
    ],
    types: { x: 'x', y0: 'line', y1: 'line' },
    names: { y0: 'Views', y1: 'Shares' },
    colors: { y0: 'LIGHT#3390ec', y1: 'LIGHT#f5a623' },
  });

  const graph = parseTelegramStatsGraph('msg-1', 'Interactions', msgJson);
  const daily = extractDailyActivityFromGraph(graph);
  assert.equal(daily.length, 3);
  assert.deepEqual(daily[0], { dateKey: '2026-10-30', views: 12, shares: 1 });
  assert.deepEqual(daily[2], { dateKey: '2026-11-09', views: 4, shares: 2 });
});

test('attributeDateFromMessageStats attributes exact views & shares on any date back to individual older posts', () => {
  const posts = groupAlbumPosts(
    [
      {
        id: 210,
        date: Date.UTC(2026, 10, 9, 12, 0),
        text: 'Recent post',
        views: 15,
        forwards: 0,
        replies: 1,
        groupedId: null,
        mediaKind: 'text',
        reactions: [],
      },
      {
        id: 142,
        date: Date.UTC(2026, 9, 18, 12, 0),
        text: 'Older evergreen post',
        views: 310,
        forwards: 6,
        replies: 4,
        groupedId: null,
        mediaKind: 'audio',
        reactions: [{ emoji: '🔥', count: 9 }],
      },
    ],
    new Set([210]),
  );

  const interactionsGraph: ParsedStatsGraph = {
    id: 'interactions',
    title: 'Interactions',
    type: 'line',
    timestamps: [Date.UTC(2026, 10, 8), Date.UTC(2026, 10, 9)],
    series: [
      { key: 'y0', label: 'Views', color: '#45d168', values: [20, 39] },
      { key: 'y1', label: 'Shares', color: '#f5a623', values: [0, 4] },
    ],
  };

  const postStatsByPost: Record<string, PostDetailedStats> = {
    'msg:210': {
      postKey: 'msg:210',
      primaryId: 210,
      dailyBreakdown: [{ dateKey: '2026-11-09', views: 15, shares: 0 }],
      publicForwards: [],
      loadedAt: Date.now(),
    },
    'msg:142': {
      postKey: 'msg:142',
      primaryId: 142,
      dailyBreakdown: [{ dateKey: '2026-11-09', views: 24, shares: 4 }],
      publicForwards: [],
      loadedAt: Date.now(),
    },
  };

  const attribution = attributeDateFromMessageStats({
    dateKey: '2026-11-09',
    interactionsGraph,
    posts,
    postStatsByPost,
    dailyDeltas: [],
    publicForwardsByPost: {},
  });

  assert.equal(attribution.graphTotalViews, 39);
  assert.equal(attribution.graphTotalShares, 4);
  assert.equal(attribution.attributedViewsSum, 39);
  assert.equal(attribution.attributedSharesSum, 4);
  assert.equal(attribution.unattributedShares, 0);
  assert.equal(attribution.contributions[0].post.primaryId, 142);
  assert.equal(attribution.contributions[0].shareContributionPct, 100);
});

test('computeEvergreenRatio, computeChannelBenchmarks, and computeWeekdayHourMatrix calculate actionable metrics', () => {
  const raw: RawChannelMessage[] = [
    {
      id: 1,
      date: Date.UTC(2026, 9, 1, 16, 0),
      text: 'Post A',
      views: 100,
      forwards: 2,
      replies: 0,
      groupedId: null,
      mediaKind: 'text',
      reactions: [],
    },
    {
      id: 2,
      date: Date.UTC(2026, 9, 2, 16, 0),
      text: 'Post B',
      views: 200,
      forwards: 8,
      replies: 1,
      groupedId: null,
      mediaKind: 'album',
      reactions: [],
    } as unknown as RawChannelMessage,
    {
      id: 3,
      date: Date.UTC(2026, 9, 18, 16, 0),
      text: 'Post C',
      views: 900,
      forwards: 10,
      replies: 5,
      groupedId: null,
      mediaKind: 'video',
      reactions: [],
    },
  ];

  const posts = groupAlbumPosts(raw);
  const benchmarks = computeChannelBenchmarks(posts);
  assert.equal(benchmarks.medianViews, 200);
  assert.equal(benchmarks.p90Views, 900);
  assert.equal(benchmarks.totalPrivateShares, 20);

  const evergreen = computeEvergreenRatio(Date.UTC(2026, 9, 1, 16, 0), [
    { dateKey: '2026-10-01', views: 50, shares: 0 },
    { dateKey: '2026-10-10', views: 50, shares: 2 },
  ]);
  assert.ok(evergreen > 50);

  const matrix = computeWeekdayHourMatrix(posts);
  assert.equal(matrix.length, 42); // 7 weekdays * 6 blocks
  assert.ok(exportPostsToCsv(posts).includes('public_shares,private_shares'));
});

test('computeSnapshotDeltas accurately calculates deltas from baseline snapshot', () => {
  const posts = groupAlbumPosts([
    {
      id: 50,
      date: Date.UTC(2026, 9, 10),
      text: 'Baseline test',
      views: 420,
      forwards: 9,
      replies: 1,
      groupedId: null,
      mediaKind: 'photo',
      reactions: [{ emoji: '🔥', count: 5 }],
    },
  ]);

  const snap = buildSnapshotFromPosts(1, 500, [
    { ...posts[0], views: 390, forwards: 6, reactionsCount: 3 },
  ]);

  const deltas = computeSnapshotDeltas(posts, snap);
  assert.equal(deltas[0].deltaViews, 30);
  assert.equal(deltas[0].deltaShares, 3);
  assert.equal(deltas[0].deltaReactions, 2);
});

test('dual-axis detection and integer tick computation prevent crushed Shares lines', () => {
  const ticksSmall = computeAxisTicks(0, 4);
  assert.deepEqual(ticksSmall, [0, 1, 2, 3, 4]);

  const ticksZeroToOne = computeAxisTicks(0, 1);
  assert.deepEqual(ticksZeroToOne, [0, 1]);

  const ticksLarge = computeAxisTicks(0, 785);
  assert.equal(ticksLarge.length, 5);
  assert.equal(ticksLarge[0], 0);
  assert.equal(ticksLarge[4], 785);

  const viewsAndShares = [
    { key: 'y0', label: 'Views', color: '#3390ec', values: [120, 785, 650] },
    { key: 'y1', label: 'Shares', color: '#f5a623', values: [0, 4, 3] },
  ];
  assert.equal(shouldUseDualAxis(viewsAndShares, 'line'), true);
  assert.equal(shouldUseDualAxis(viewsAndShares, 'step'), true);
  assert.equal(shouldUseDualAxis([viewsAndShares[0]], 'line'), false);
  assert.equal(shouldUseDualAxis(viewsAndShares, 'bar'), false);

  const reversedOrder = [
    { key: 'y0', label: 'Shares', color: '#f5a623', values: [0, 4, 3] },
    { key: 'y1', label: 'Views', color: '#3390ec', values: [120, 785, 650] },
  ];
  const reversedPlan = resolveDualAxisPlan(reversedOrder, 'line', undefined, true);
  assert.equal(reversedPlan.isDualAxis, true);
  assert.deepEqual(reversedPlan.leftSeriesIndices, [1]);
  assert.deepEqual(reversedPlan.rightSeriesIndices, [0]);

  const parsedYScaled = parseTelegramStatsGraph(
    'tg-1',
    'Interactions',
    JSON.stringify({
      columns: [
        ['x', Date.UTC(2026, 10, 15)],
        ['y0', 5],
        ['y1', 1],
      ],
      types: { x: 'x', y0: 'line', y1: 'line' },
      names: { y0: 'Views', y1: 'Shares' },
      colors: { y0: 'NIGHT#3390ec', y1: 'NIGHT#f5a623' },
      y_scaled: true,
    }),
  );
  assert.equal(parsedYScaled.yScaled, true);
});

test('media formatters and getPostDisplayTitle handle captionless audio and poll posts cleanly', () => {
  assert.equal(formatMediaDuration(205), '3:25');
  assert.equal(formatMediaDuration(3665), '1:01:05');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(4 * 1024 * 1024), '4.0 MB');

  const posts = groupAlbumPosts([
    {
      id: 1406,
      date: Date.UTC(2026, 9, 30),
      text: '',
      views: 48,
      forwards: 1,
      replies: 0,
      groupedId: null,
      mediaKind: 'audio',
      mediaMeta: {
        title: 'Metamorphosis',
        performer: '0xAudio',
        durationSec: 184,
      },
      reactions: [],
    },
  ]);

  assert.equal(getPostDisplayTitle(posts[0], 'en'), '0xAudio — Metamorphosis');
  assert.equal(getPostDisplayTitle(posts[0], 'fa'), '0xAudio — Metamorphosis');
});


test('extractDailyActivityFromGraph aggregates hourly data points into single daily bucket', () => {
  const hourlyGraph: ParsedStatsGraph = {
    id: 'post-hourly',
    title: 'Interactions',
    type: 'line',
    timestamps: [
      Date.UTC(2026, 10, 15, 1, 0), // 01:00 AM
      Date.UTC(2026, 10, 15, 2, 0), // 02:00 AM
      Date.UTC(2026, 10, 15, 3, 0), // 03:00 AM
      Date.UTC(2026, 10, 16, 1, 0), // Next day
    ],
    series: [
      { key: 'y0', label: 'Views', color: '#3390ec', values: [1, 5, 20, 10] },
      { key: 'y1', label: 'Shares', color: '#f5a623', values: [0, 1, 2, 3] },
    ],
  };

  const daily = extractDailyActivityFromGraph(hourlyGraph);
  assert.equal(daily.length, 2);
  // Nov 15 must be 1 + 5 + 20 = 26 views, 0 + 1 + 2 = 3 shares (not truncated to 1 view)
  assert.deepEqual(daily[0], { dateKey: '2026-11-15', views: 26, shares: 3 });
  assert.deepEqual(daily[1], { dateKey: '2026-11-16', views: 10, shares: 3 });
});

test('extractDailyActivityFromGraph detects cumulative running totals and computes daily deltas', () => {
  const cumulativeGraph: ParsedStatsGraph = {
    id: 'post-cumulative',
    title: 'Interactions',
    type: 'line',
    timestamps: [
      Date.UTC(2026, 10, 14),
      Date.UTC(2026, 10, 15),
      Date.UTC(2026, 10, 16),
      Date.UTC(2026, 10, 17),
    ],
    series: [
      { key: 'y0', label: 'Views', color: '#3390ec', values: [100, 140, 190, 250] },
    ],
  };

  const daily = extractDailyActivityFromGraph(cumulativeGraph);
  assert.equal(daily.length, 4);
  assert.equal(daily[0].views, 100);
  assert.equal(daily[1].views, 40); // 140 - 100
  assert.equal(daily[2].views, 50); // 190 - 140
  assert.equal(daily[3].views, 60); // 250 - 190
});

test('attributeDateFromMessageStats automatically attributes posts published on the selected date', () => {
  const posts = groupAlbumPosts(
    [
      {
        id: 301,
        date: Date.UTC(2026, 10, 15, 10, 30),
        text: 'Published on date',
        views: 85,
        forwards: 7,
        replies: 0,
        groupedId: null,
        mediaKind: 'text',
        reactions: [],
      },
    ],
    new Set([301]),
  );

  const interactionsGraph: ParsedStatsGraph = {
    id: 'interactions',
    title: 'Interactions',
    type: 'line',
    timestamps: [Date.UTC(2026, 10, 15)],
    series: [
      { key: 'y0', label: 'Views', color: '#3390ec', values: [100] },
      { key: 'y1', label: 'Shares', color: '#f5a623', values: [10] },
    ],
  };

  // No stats pre-loaded for post 301 in postStatsByPost
  const attribution = attributeDateFromMessageStats({
    dateKey: '2026-11-15',
    interactionsGraph,
    posts,
    postStatsByPost: {},
    dailyDeltas: [],
    publicForwardsByPost: {},
  });

  assert.equal(attribution.contributions.length, 1);
  assert.equal(attribution.contributions[0].post.primaryId, 301);
  assert.equal(attribution.contributions[0].viewsOnDate, 85);
  assert.equal(attribution.contributions[0].sharesOnDate, 7);
  assert.equal(attribution.attributedViewsSum, 85);
  assert.equal(attribution.attributedSharesSum, 7);
});

test('computeSnapshotDeltas ignores ancient posts missing from snapshot and attributes new posts', () => {
  const snapshotDate = Date.UTC(2026, 10, 14, 12, 0);
  const prevSnapshot: ChannelSnapshot = {
    channelId: 100,
    capturedAt: snapshotDate,
    membersCount: 500,
    posts: {},
  };

  const rawPosts: RawChannelMessage[] = [
    {
      id: 1342, // Published in April (months before snapshot)
      date: Date.UTC(2026, 3, 18, 12, 0),
      text: 'Old post',
      views: 350,
      forwards: 2,
      replies: 0,
      groupedId: null,
      mediaKind: 'text',
      reactions: [],
    },
    {
      id: 1406, // Published AFTER snapshot
      date: Date.UTC(2026, 10, 15, 10, 0),
      text: 'New latest post',
      views: 45,
      forwards: 1,
      replies: 0,
      groupedId: null,
      mediaKind: 'audio',
      reactions: [],
    },
  ];

  const posts = groupAlbumPosts(rawPosts);
  const deltas = computeSnapshotDeltas(posts, prevSnapshot);

  const oldPostDelta = deltas.find((p) => p.primaryId === 1342);
  const newPostDelta = deltas.find((p) => p.primaryId === 1406);

  // Ancient post must NOT receive fake deltaShares = 2!
  assert.equal(oldPostDelta?.deltaShares, 0);
  assert.equal(oldPostDelta?.deltaViews, 0);

  // New post published after snapshot correctly receives its deltas
  assert.equal(newPostDelta?.deltaShares, 1);
  assert.equal(newPostDelta?.deltaViews, 45);
});

test('attributeDateFromMessageStats attributes latest post #1406 in recent launch window and purges bogus historical deltas', () => {
  const posts = groupAlbumPosts([
    {
      id: 1342, // April 18 post
      date: Date.UTC(2026, 3, 18),
      text: 'April post',
      views: 350,
      forwards: 2,
      replies: 0,
      groupedId: null,
      mediaKind: 'text',
      reactions: [],
    },
    {
      id: 1406, // Latest post published on Nov 15
      date: Date.UTC(2026, 10, 15, 14, 0),
      text: 'Latest post 1406',
      views: 60,
      forwards: 1,
      replies: 0,
      groupedId: null,
      mediaKind: 'audio',
      reactions: [],
    },
  ]);

  const interactionsGraph: ParsedStatsGraph = {
    id: 'interactions',
    title: 'Interactions',
    type: 'line',
    timestamps: [Date.UTC(2026, 10, 15)],
    series: [
      { key: 'y0', label: 'Views', color: '#3390ec', values: [100] },
      { key: 'y1', label: 'Shares', color: '#f5a623', values: [3] },
    ],
  };

  // Simulate corrupt legacy dailyDelta in IndexedDB that falsely claimed #1342 got 2 shares on Nov 15
  const bogusDeltas: DailyDeltaRecord[] = [
    {
      dateKey: '2026-11-15',
      postKey: 'msg:1342',
      primaryId: 1342,
      deltaShares: 2,
      deltaViews: 1,
    },
  ];

  const attribution = attributeDateFromMessageStats({
    dateKey: '2026-11-15',
    interactionsGraph,
    posts,
    postStatsByPost: {},
    dailyDeltas: bogusDeltas,
    publicForwardsByPost: {},
  });

  // #1406 must be ranked #1 with sharesOnDate = 1
  assert.equal(attribution.contributions[0].post.primaryId, 1406);
  assert.equal(attribution.contributions[0].sharesOnDate, 1);

  // #1342 must have had its corrupt delta discarded (sharesOnDate = 0)
  const oldPostContrib = attribution.contributions.find((c) => c.post.primaryId === 1342);
  assert.equal(oldPostContrib?.sharesOnDate ?? 0, 0);
});

test('extractDailyActivityFromGraph treats index 0 as carryover baseline for posts published prior to graph start', () => {
  const viewsGraph: ParsedStatsGraph = {
    id: 'post-1405-views',
    title: 'Interactions',
    type: 'line',
    timestamps: [
      Date.UTC(2026, 10, 15, 0, 0), // Nov 15 (graph starts here)
      Date.UTC(2026, 10, 16, 0, 0), // Nov 16
    ],
    series: [
      { key: 'y0', label: 'Views', color: '#3390ec', values: [5, 5] },
    ],
  };

  // Post was published on Nov 10 (before graph start)
  const postDateNov10 = Date.UTC(2026, 10, 10, 12, 0);
  const dailyOld = extractDailyActivityFromGraph(viewsGraph, postDateNov10);

  // Index 0 (Nov 15) must be 0 views (not 5!), because those 5 views happened on Nov 10!
  assert.equal(dailyOld.find((d) => d.dateKey === '2026-11-15')?.views, 0);
  assert.equal(dailyOld.find((d) => d.dateKey === '2026-11-16')?.views, 0);

  // Conversely, if post was published ON Nov 15, index 0 is valid publication views
  const postDateNov15 = Date.UTC(2026, 10, 15, 2, 0);
  const dailyNew = extractDailyActivityFromGraph(viewsGraph, postDateNov15);
  assert.equal(dailyNew.find((d) => d.dateKey === '2026-11-15')?.views, 5);
});

test('attributeDateFromMessageStats discards index 0 baseline carryover for older posts with 0 shares', () => {
  const post1405: PostRecord = {
    key: 'msg:1405',
    primaryId: 1405,
    messageIds: [1405],
    groupedId: null,
    isAlbum: false,
    albumChildren: [],
    date: Date.parse('2026-11-10T12:00:00Z'),
    text: 'Older post with 0 shares',
    mediaKind: 'text',
    views: 6, // lifetime views grew to 6
    forwards: 0,
    albumTotalItemForwards: 0,
    publicSharesCount: 0,
    privateSharesCount: 0,
    replies: 0,
    reactionsCount: 0,
    reactions: [],
    shareRatePercent: 0,
    engagementRatePercent: 0,
    deltaViews: 0,
    deltaShares: 0,
    deltaReactions: 0,
    evergreenShareRatio: 0,
    inRecentWindow: true,
  };

  const post1342: PostRecord = {
    key: 'msg:1342',
    primaryId: 1342,
    messageIds: [1342],
    groupedId: null,
    isAlbum: false,
    albumChildren: [],
    date: Date.parse('2026-04-18T12:00:00Z'),
    text: 'Evergreen post shared on Nov 15',
    mediaKind: 'text',
    views: 120,
    forwards: 15,
    albumTotalItemForwards: 15,
    publicSharesCount: 0,
    privateSharesCount: 15,
    replies: 0,
    reactionsCount: 0,
    reactions: [],
    shareRatePercent: 12.5,
    engagementRatePercent: 12.5,
    deltaViews: 0,
    deltaShares: 0,
    deltaReactions: 0,
    evergreenShareRatio: 100,
    inRecentWindow: false,
  };

  const post1406: PostRecord = {
    key: 'msg:1406',
    primaryId: 1406,
    messageIds: [1406],
    groupedId: null,
    isAlbum: false,
    albumChildren: [],
    date: Date.parse('2026-11-15T02:00:00Z'),
    text: 'Brand new post on Nov 15',
    mediaKind: 'text',
    views: 7,
    forwards: 1,
    albumTotalItemForwards: 1,
    publicSharesCount: 0,
    privateSharesCount: 1,
    replies: 0,
    reactionsCount: 0,
    reactions: [],
    shareRatePercent: 14,
    engagementRatePercent: 14,
    deltaViews: 0,
    deltaShares: 0,
    deltaReactions: 0,
    evergreenShareRatio: 0,
    inRecentWindow: true,
  };

  const postStatsByPost: Record<string, PostDetailedStats> = {
    'msg:1405': {
      postKey: 'msg:1405',
      primaryId: 1405,
      dailyBreakdown: [
        { dateKey: '2026-11-15', views: 5, shares: 0 },
      ],
      publicForwards: [],
      loadedAt: Date.now(),
    },
    'msg:1342': {
      postKey: 'msg:1342',
      primaryId: 1342,
      dailyBreakdown: [
        { dateKey: '2026-11-15', views: 1, shares: 2 },
      ],
      publicForwards: [],
      loadedAt: Date.now(),
    },
    'msg:1406': {
      postKey: 'msg:1406',
      primaryId: 1406,
      dailyBreakdown: [
        { dateKey: '2026-11-15', views: 7, shares: 1 },
      ],
      publicForwards: [],
      loadedAt: Date.now(),
    },
  };

  const attribution = attributeDateFromMessageStats({
    dateKey: '2026-11-15',
    posts: [post1405, post1342, post1406],
    postStatsByPost,
    dailyDeltas: [],
    publicForwardsByPost: {},
  });

  // Exactly 2 posts (#1342 and #1406) must be attributed; #1405 must be completely excluded!
  assert.equal(attribution.contributions.length, 2);
  assert.equal(attribution.contributions[0].post.primaryId, 1342);
  assert.equal(attribution.contributions[0].sharesOnDate, 2);
  assert.equal(attribution.contributions[1].post.primaryId, 1406);
  assert.equal(attribution.contributions[1].sharesOnDate, 1);
  assert.equal(attribution.attributedSharesSum, 3);
  assert.equal(attribution.attributedViewsSum, 8);
});

test('exportPostsToCsv neutralizes spreadsheet formula injection prefixes', () => {
  const posts = groupAlbumPosts([
    {
      id: 9001,
      date: Date.UTC(2026, 10, 15),
      text: '=HYPERLINK("https://evil.test","Click")',
      views: 10,
      forwards: 1,
      replies: 0,
      groupedId: null,
      mediaKind: 'text',
      reactions: [],
      permalink: '+cmd|calc',
    },
  ]);

  const csv = exportPostsToCsv(posts);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'+cmd|calc"));
});

test('attributeDateFromMessageStats indexes >16 dailyBreakdown entries and computeWeekdayHourMatrix matches UTC offset math', () => {
  const posts = groupAlbumPosts([
    {
      id: 10,
      date: Date.UTC(2026, 9, 1, 22, 0), // Thu Oct 1 22:00 UTC -> Fri Oct 2 01:30 Iran (+210 min)
      text: 'Album item 1',
      views: 150,
      forwards: 4,
      replies: 2,
      groupedId: 'grp1',
      mediaKind: 'photo',
      reactions: [{ emoji: '🔥', count: 5 }],
    },
    {
      id: 11,
      date: Date.UTC(2026, 9, 1, 22, 0),
      text: '',
      views: 180,
      forwards: 6,
      replies: 1,
      groupedId: 'grp1',
      mediaKind: 'document',
      reactions: [{ emoji: '🔥', count: 8 }, { emoji: '👍', count: 3 }],
    },
  ]);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].isAlbum, true);
  assert.equal(posts[0].views, 180);
  assert.equal(posts[0].forwards, 6);
  assert.equal(posts[0].albumTotalItemForwards, 10);
  assert.equal(posts[0].replies, 2);
  assert.equal(posts[0].reactionsCount, 11);

  const dailyBreakdown = Array.from({ length: 20 }, (_, i) => ({
    dateKey: `2026-10-${String(i + 1).padStart(2, '0')}`,
    views: i === 18 ? 42 : 5,
    shares: i === 18 ? 3 : 0,
  }));

  const attr = attributeDateFromMessageStats({
    dateKey: '2026-10-19',
    posts,
    postStatsByPost: {
      'album:grp1': {
        postKey: 'album:grp1',
        primaryId: 10,
        dailyBreakdown,
        publicForwards: [],
        loadedAt: Date.now(),
      },
    },
    dailyDeltas: [],
    publicForwardsByPost: {},
  });
  assert.equal(attr.contributions.length, 1);
  assert.equal(attr.contributions[0].viewsOnDate, 42);
  assert.equal(attr.contributions[0].sharesOnDate, 3);

  const matrix = computeWeekdayHourMatrix(posts, 210);
  // Fri (weekday=5), 01:30 -> hourBlock=0
  const cell = matrix.find((c) => c.weekday === 5 && c.hourBlock === 0);
  assert.equal(cell?.postCount, 1);
  assert.equal(cell?.avgViews, 180);
});
