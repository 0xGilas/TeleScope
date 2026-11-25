import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ArrowDown, Layers, Search } from 'lucide-react';
import type {
  LanguageCode,
  PostFilterMode,
  PostRecord,
  PostSortBy,
} from '../../types/analytics';
import { getTranslations } from '../../i18n/translations';
import {
  computeChannelBenchmarks,
  filterAndSortPosts,
  getPostDisplayTitle,
} from '../../utils/analyticsMath';

interface ShareDetectiveTabProps {
  lang: LanguageCode;
  posts: PostRecord[];
  onOpenPost: (post: PostRecord) => void;
}

const PAGE_SIZE = 50;

const shortDateFormatterCache: Record<LanguageCode, Intl.DateTimeFormat> = {
  fa: new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
};

function formatShortDate(ts: number, lang: LanguageCode): string {
  return Number.isFinite(ts) ? shortDateFormatterCache[lang].format(ts) : '—';
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true,
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export const ShareDetectiveTab: React.FC<ShareDetectiveTabProps> = React.memo(({
  lang,
  posts,
  onOpenPost,
}) => {
  const t = getTranslations(lang);
  const isDesktop = useIsDesktop();
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<PostFilterMode>('has_shares');
  const [sortBy, setSortBy] = useState<PostSortBy>('shares_desc');
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);

  const channelFingerprint =
    posts.length === 0
      ? 'empty'
      : `${posts[posts.length - 1].key}:${posts[posts.length - 1].date}:${posts[0].permalink?.replace(/\/\d+$/, '') ?? ''}`;

  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [channelFingerprint, deferredQuery, filterMode, sortBy]);

  const referenceNow = useMemo(() => {
    if (posts.length === 0) return Date.now();
    let maxDate = 0;
    for (let i = 0; i < posts.length; i += 1) {
      if (posts[i].date > maxDate) maxDate = posts[i].date;
    }
    return maxDate + 1000;
  }, [posts]);

  const benchmarks = useMemo(() => computeChannelBenchmarks(posts), [posts]);

  const visiblePosts = useMemo(
    () => filterAndSortPosts(posts, deferredQuery, filterMode, sortBy, referenceNow),
    [posts, deferredQuery, filterMode, sortBy, referenceNow],
  );

  const pagedPosts = useMemo(
    () => visiblePosts.slice(0, displayLimit),
    [visiblePosts, displayLimit],
  );
  const remainingCount = Math.max(0, visiblePosts.length - pagedPosts.length);

  const filterButtons: Array<{ id: PostFilterMode; label: string }> = [
    { id: 'all', label: t.filterAll },
    { id: 'has_shares', label: t.filterHasShares },
    { id: 'evergreen', label: t.filterEvergreen },
    { id: 'albums', label: t.filterAlbums },
    { id: 'older_than_7d', label: t.filterOlder7d },
  ];

  const getMedianMultiplier = (views: number): string => {
    if (benchmarks.medianViews <= 0) return '1.0×';
    return `${(views / benchmarks.medianViews).toFixed(1)}×`;
  };

  return (
    <section className="tg-panel rounded-xl overflow-hidden">
      {/* Integrated Filter & Search Bar */}
      <div className="p-4 border-b border-white/[0.07] space-y-3 bg-[#0B0F14]/45">
        <div className="flex flex-col sm:flex-row gap-3 justify-between">
          <div className="flex items-center flex-1 max-w-md rounded-lg border border-white/12 bg-[#0B0F14] overflow-hidden focus-within:border-[#2AABEE] focus-within:ring-2 focus-within:ring-[#2AABEE]/25 transition-colors">
            <span className="ps-3 pe-1 text-[#8596AA] shrink-0 flex items-center pointer-events-none">
              <Search className="w-4 h-4" aria-hidden="true" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="flex-1 min-w-0 bg-transparent px-2.5 py-2 text-xs text-[#F0F4F8] placeholder:text-[#8596AA] border-0 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as PostSortBy)}
              aria-label={t.sortPostsLabel}
              className="rounded-lg border border-white/12 bg-[#0B0F14] px-3 py-2 text-xs text-[#F0F4F8] focus:border-[#2AABEE] focus:outline-none cursor-pointer"
            >
              <option value="shares_desc">{t.sortShares}</option>
              <option value="share_rate_desc">{t.sortRate}</option>
              <option value="views_desc">{t.sortViews}</option>
              <option value="evergreen_desc">{t.sortEvergreen}</option>
              <option value="reactions_desc">{t.sortReactions}</option>
              <option value="delta_desc">{t.sortDelta}</option>
              <option value="date_desc">{t.sortDate}</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {filterButtons.map((btn) => {
            const active = filterMode === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilterMode(btn.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#2AABEE] text-[#090C10] font-semibold'
                    : 'bg-[#0B0F14] text-[#8B9BB0] hover:text-[#F0F4F8] border border-white/[0.08]'
                }`}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table Body */}
      {visiblePosts.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <p className="text-sm text-[#7f91a4]">{t.noMatchingPosts}</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilterMode('all');
            }}
            className="rounded-lg border border-white/10 bg-[#111923] px-4 py-2 text-xs font-medium text-[#f5f7fa] hover:bg-[#1e2c3a] cursor-pointer"
          >
            {t.resetFiltersBtn}
          </button>
        </div>
      ) : (
        <>
          {!isDesktop ? (
            /* Mobile Compact List (< md) */
            <div className="divide-y divide-white/[0.06]">
              {pagedPosts.map((post) => {
                const isOutlier = benchmarks.p90Views > 0 && post.views >= benchmarks.p90Views;
                const displayTitle = getPostDisplayTitle(post, lang);
                return (
                  <button
                    key={post.key}
                    type="button"
                    onClick={() => onOpenPost(post)}
                    className="w-full p-4 text-start hover:bg-white/[0.03] transition-colors space-y-1.5 cursor-pointer"
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#7f91a4] font-mono-num">
                      <span dir="ltr">#{post.primaryId}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t.mediaKindLabels[post.mediaKind] ?? post.mediaKind}</span>
                      {post.isAlbum && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-[#5eb5f7]">
                            <Layers className="w-3 h-3" aria-hidden="true" />
                            {post.albumChildren.length} {t.itemsLabel}
                          </span>
                        </>
                      )}
                      {!post.inRecentWindow && post.forwards > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#f5a623]">{t.oldPostTag}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      {post.mediaMeta?.thumbUrl && (
                        <img
                          src={post.mediaMeta.thumbUrl}
                          alt=""
                          loading="lazy"
                          className="w-8 h-8 rounded-md object-cover border border-white/10 shrink-0"
                        />
                      )}
                      <div
                        className="text-xs font-medium text-[#f5f7fa] line-clamp-2 leading-relaxed"
                        title={displayTitle}
                      >
                        {displayTitle}
                      </div>
                    </div>
                    <div
                      dir="ltr"
                      className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono-num"
                    >
                      <span className="text-[#8B9BB0]">
                        {formatShortDate(post.date, lang)}
                      </span>
                      <div className="flex items-center gap-2.5">
                        <span className={isOutlier ? 'text-[#4dcd5e] font-semibold' : 'text-[#f5f7fa]'}>
                          {post.views} ({getMedianMultiplier(post.views)})
                        </span>
                        <span className="text-[#f5a623] font-semibold">
                          {post.forwards} sh ({post.publicSharesCount}/{post.privateSharesCount})
                        </span>
                        <span className="text-[#5eb5f7]">{post.shareRatePercent.toFixed(1)}%</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Desktop High-Density Table */
            <div className="overflow-x-auto">
              <table className="w-full text-start border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-[#0B0F14]/80 text-[11px] font-semibold text-[#8B9BB0]">
                    <th className="py-2.5 px-4 text-start">{t.colPost}</th>
                    {(
                      [
                        { key: 'date_desc', label: t.colDate, align: 'text-start', px: 'px-3' },
                        { key: 'views_desc', label: t.colViews, align: 'text-end', px: 'px-3' },
                        { key: 'shares_desc', label: t.colShares, align: 'text-end', px: 'px-3' },
                        { key: 'evergreen_desc', label: t.colEvergreen, align: 'text-end', px: 'px-3' },
                        { key: 'share_rate_desc', label: t.colRate, align: 'text-end', px: 'px-3' },
                        { key: 'reactions_desc', label: t.colReactions, align: 'text-end', px: 'px-4' },
                      ] as const
                    ).map((col) => {
                      const isSorted = sortBy === col.key;
                      return (
                        <th
                          key={col.key}
                          className={`py-2.5 ${col.px} ${col.align} whitespace-nowrap`}
                          aria-sort={isSorted ? 'descending' : 'none'}
                        >
                          <button
                            type="button"
                            onClick={() => setSortBy(col.key)}
                            className={`inline-flex items-center gap-1 hover:text-[#F0F4F8] cursor-pointer ${
                              isSorted ? 'text-[#5EC2F6]' : ''
                            }`}
                          >
                            <span>{col.label}</span>
                            {isSorted && <ArrowDown className="w-3 h-3 shrink-0" aria-hidden="true" />}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {pagedPosts.map((post) => {
                    const isOutlier = benchmarks.p90Views > 0 && post.views >= benchmarks.p90Views;
                    const displayTitle = getPostDisplayTitle(post, lang);
                    return (
                      <tr
                        key={post.key}
                        onClick={() => onOpenPost(post)}
                        className="hover:bg-white/[0.03] transition-colors cursor-pointer"
                      >
                        <td className="py-2.5 px-4 max-w-md">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenPost(post);
                            }}
                            className="w-full text-start group cursor-pointer flex items-center gap-3"
                          >
                            {post.mediaMeta?.thumbUrl && (
                              <img
                                src={post.mediaMeta.thumbUrl}
                                alt=""
                                loading="lazy"
                                className="w-8 h-8 rounded-md object-cover border border-white/10 shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[11px] text-[#7f91a4] font-mono-num">
                                <span dir="ltr">#{post.primaryId}</span>
                                <span aria-hidden="true">·</span>
                                <span>{t.mediaKindLabels[post.mediaKind] ?? post.mediaKind}</span>
                                {post.isAlbum && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-1 text-[#5eb5f7]">
                                      <Layers className="w-3 h-3" aria-hidden="true" />
                                      {post.albumChildren.length} {t.itemsLabel}
                                    </span>
                                  </>
                                )}
                                {!post.inRecentWindow && post.forwards > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-[#f5a623]">{t.oldPostTag}</span>
                                  </>
                                )}
                              </div>
                              <div
                                className="mt-0.5 text-[13px] font-medium text-[#f5f7fa] group-hover:text-[#5eb5f7] truncate"
                                title={displayTitle}
                              >
                                {displayTitle}
                              </div>
                            </div>
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-[#8B9BB0] font-mono-num whitespace-nowrap">
                          {formatShortDate(post.date, lang)}
                        </td>
                        <td className="py-2.5 px-3 text-end text-xs font-mono-num whitespace-nowrap">
                          <span dir="ltr" className="inline-flex items-baseline gap-1.5">
                            <span className="text-[#f5f7fa]">{post.views.toLocaleString('en-US')}</span>
                            <span className={isOutlier ? 'text-[#4dcd5e] font-semibold' : 'text-[#8596AA]'}>
                              ({getMedianMultiplier(post.views)})
                            </span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-end text-xs font-mono-num whitespace-nowrap">
                          <span dir="ltr" className="inline-flex items-baseline gap-1.5">
                            <span className="font-semibold text-[#f5a623]">
                              {post.forwards.toLocaleString('en-US')}
                            </span>
                            <span className="text-[11px] text-[#7f91a4]">
                              ({post.publicSharesCount}/{post.privateSharesCount})
                            </span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-end text-xs font-mono-num whitespace-nowrap">
                          <span className={post.evergreenShareRatio >= 25 ? 'text-[#4dcd5e]' : 'text-[#7f91a4]'}>
                            {post.evergreenShareRatio}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-end text-xs text-[#5eb5f7] font-mono-num whitespace-nowrap">
                          {post.shareRatePercent.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-4 text-end text-xs text-[#7f91a4] font-mono-num whitespace-nowrap">
                          <span dir="ltr" className="inline-block">
                            {post.reactionsCount} / {post.replies}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {remainingCount > 0 && (
            <div className="p-3.5 border-t border-white/[0.06] bg-[#0B0F14]/40 flex justify-center">
              <button
                type="button"
                onClick={() => setDisplayLimit((prev) => prev + PAGE_SIZE)}
                className="rounded-lg border border-white/10 bg-[#11161D] px-4 py-1.5 text-xs font-medium text-[#5EC2F6] hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                {lang === 'fa'
                  ? `نمایش ${Math.min(PAGE_SIZE, remainingCount)} پست بیشتر (${remainingCount} باقی‌مانده)`
                  : `Show ${Math.min(PAGE_SIZE, remainingCount)} more posts (${remainingCount} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
});

ShareDetectiveTab.displayName = 'ShareDetectiveTab';

