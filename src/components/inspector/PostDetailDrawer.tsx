import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Layers, RefreshCw, X } from 'lucide-react';
import type {
  LanguageCode,
  PostDetailedStats,
  PostMediaPreview,
  PostRecord,
  PublicForwardRecord,
} from '../../types/analytics';
import { getTranslations } from '../../i18n/translations';
import { useDialogAccessibility } from '../../utils/dialogA11y';
import { TelegramTimeChart } from '../charts/TelegramTimeChart';
import { PostPreviewCard } from './PostPreviewCard';

const UTC_DATE_TIME_FORMATTERS: Record<LanguageCode, Intl.DateTimeFormat> = {
  fa: new Intl.DateTimeFormat('fa-IR', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }),
  en: new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }),
};

const UTC_DATE_FORMATTERS: Record<LanguageCode, Intl.DateTimeFormat> = {
  fa: new Intl.DateTimeFormat('fa-IR', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }),
  en: new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }),
};

function formatUtcDateTime(ts: number, lang: LanguageCode): string {
  return UTC_DATE_TIME_FORMATTERS[lang].format(ts);
}

function formatUtcDate(ts: number, lang: LanguageCode): string {
  return UTC_DATE_FORMATTERS[lang].format(ts);
}

function getSafeExternalTelegramUrl(raw?: string): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

const DRAWER_ROW_LIMIT = 40;

interface PostDetailDrawerProps {
  lang: LanguageCode;
  post: PostRecord | null;
  details: PostDetailedStats | undefined;
  mediaPreview?: PostMediaPreview;
  loadingMediaPreview?: boolean;
  publicForwards: PublicForwardRecord[];
  isSampleMode: boolean;
  loadingDetails: boolean;
  detailsError?: string | null;
  onLoadLiveDetails: (post: PostRecord) => void;
  onClose: () => void;
}

export const PostDetailDrawer: React.FC<PostDetailDrawerProps> = React.memo(({
  lang,
  post,
  details,
  mediaPreview,
  loadingMediaPreview = false,
  publicForwards,
  isSampleMode,
  loadingDetails,
  detailsError = null,
  onLoadLiveDetails,
  onClose,
}) => {
  const t = getTranslations(lang);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [showAllDaily, setShowAllDaily] = useState(false);
  const [showAllForwards, setShowAllForwards] = useState(false);

  useDialogAccessibility(Boolean(post), drawerRef);

  useEffect(() => {
    setShowAllDaily(false);
    setShowAllForwards(false);
  }, [post?.key]);

  const forwardsList = details?.publicForwards ?? publicForwards;
  const activeDailyRows = useMemo(
    () => (details?.dailyBreakdown ?? []).filter((row) => row.views > 0 || row.shares > 0),
    [details?.dailyBreakdown],
  );

  if (!post) return null;

  const visibleDailyRows = showAllDaily ? activeDailyRows : activeDailyRows.slice(0, DRAWER_ROW_LIMIT);
  const visibleForwards = showAllForwards ? forwardsList : forwardsList.slice(0, DRAWER_ROW_LIMIT);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch justify-end bg-black/75 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-drawer-title"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={drawerRef}
        tabIndex={-1}
        className="relative z-10 w-full sm:max-w-lg tg-drawer-surface border-t sm:border-t-0 sm:border-s border-white/[0.12] max-h-[92vh] sm:max-h-full h-auto sm:h-full rounded-t-2xl sm:rounded-none flex flex-col shadow-2xl overflow-hidden focus:outline-none"
      >
        <div className="w-12 h-1 rounded-full bg-white/20 mx-auto my-2.5 sm:hidden shrink-0" />
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-[#10151D]">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="post-drawer-title" className="text-sm font-semibold text-[#f5f7fa]">
                {t.drawerTitle}
              </h2>
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-[#8B9BB0]">
                {t.mediaKindLabels[post.mediaKind]}
              </span>
            </div>
            <div dir="ltr" className="text-xs text-[#8B9BB0] font-mono-num mt-0.5 text-start">
              #{post.primaryId} · {formatUtcDateTime(post.date, lang)} UTC
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeBtn}
            className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg p-2 text-[#7f91a4] hover:bg-white/10 hover:text-[#f5f7fa] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Native Telegram-Style Drawer Content (Isolated scroll layer, zero nested blur) */}
        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-white/[0.06]">
          {/* Rich Post Media & Caption Preview */}
          <div className="p-5 space-y-2.5">
            <PostPreviewCard
              lang={lang}
              post={post}
              mediaPreview={mediaPreview}
              loadingMediaPreview={loadingMediaPreview}
            />
            {(() => {
              const safePermalink = getSafeExternalTelegramUrl(post.permalink);
              if (!safePermalink) return null;
              return (
                <a
                  href={safePermalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="inline-flex items-center gap-1.5 text-[11px] text-[#5eb5f7] hover:underline font-mono-num max-w-full"
                >
                  <span className="truncate">{safePermalink}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                </a>
              );
            })()}
          </div>

          {/* Native Telegram Overview Section (Matches attached Message Statistic layout) */}
          <div className="p-5 space-y-3.5">
            <h3 className="text-[13px] font-semibold text-[#5eb5f7]">
              {t.overviewSectionTitle}
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
              <div>
                <div dir="ltr" className="text-base font-bold text-[#f5f7fa] font-mono-num text-start">
                  {post.views.toLocaleString('en-US')}
                </div>
                <div className="text-xs text-[#7f91a4] mt-0.5">{t.colViews.split(' (')[0]}</div>
              </div>

              <div>
                <div dir="ltr" className="text-base font-bold text-[#5eb5f7] font-mono-num text-start">
                  {post.publicSharesCount}
                </div>
                <div className="text-xs text-[#7f91a4] mt-0.5">{t.publicSharesLabel}</div>
              </div>

              <div>
                <div dir="ltr" className="text-base font-bold text-[#f5a623] font-mono-num text-start">
                  {post.privateSharesCount}
                </div>
                <div className="text-xs text-[#7f91a4] mt-0.5">{t.privateSharesLabel}</div>
              </div>

              <div>
                <div dir="ltr" className="text-base font-bold text-[#f5f7fa] font-mono-num text-start">
                  {post.reactionsCount}
                </div>
                <div className="text-xs text-[#7f91a4] mt-0.5">{t.colReactions.split(' /')[0]}</div>
              </div>

              <div>
                <div dir="ltr" className="text-base font-bold text-[#4dcd5e] font-mono-num text-start">
                  {post.evergreenShareRatio}%
                </div>
                <div className="text-xs text-[#7f91a4] mt-0.5">{t.colEvergreen}</div>
              </div>

              <div>
                <div dir="ltr" className="text-base font-bold text-[#5eb5f7] font-mono-num text-start">
                  {post.shareRatePercent.toFixed(2)}%
                </div>
                <div className="text-xs text-[#7f91a4] mt-0.5">{t.colRate}</div>
              </div>
            </div>

            {!isSampleMode && (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={loadingDetails}
                  onClick={() => onLoadLiveDetails(post)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#2AABEE] px-4 py-2 text-xs font-semibold text-[#090C10] hover:bg-[#3CB7F5] disabled:opacity-60 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDetails ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>{t.loadLivePostStatsBtn}</span>
                </button>
                {detailsError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-[#e55353]/40 bg-[#e55353]/10 px-3 py-2 text-xs text-[#fca5a5]"
                  >
                    {detailsError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Album Breakdown if grouped_id */}
          {post.isAlbum && (
            <div className="p-5 space-y-2.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#5eb5f7]">
                <Layers className="w-4 h-4" aria-hidden="true" />
                <span>{t.albumBreakdownTitle}</span>
              </div>
              <p className="text-xs text-[#7f91a4] leading-relaxed">{t.albumBreakdownSub}</p>
              <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                {post.albumChildren.map((item, idx) => (
                  <div key={item.id} className="py-2 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span dir="ltr" className="font-mono-num text-[#8B9BB0]">#{item.id}</span>
                        <span className="mx-2 text-[#8596AA]" aria-hidden="true">·</span>
                        <span className="text-[#f5f7fa]">
                          {t.itemLabel} {idx + 1} ({t.mediaKindLabels[item.mediaKind]})
                        </span>
                      </div>
                      <div dir="ltr" className="font-mono-num text-[#8B9BB0] shrink-0">
                        <span className="text-[#f5f7fa]">{item.views}</span> {t.viewsWord} ·{' '}
                        <span className="text-[#f5a623] font-semibold">{item.forwards}</span> {t.sharesWord}
                      </div>
                    </div>
                    {item.caption && item.caption.trim().length > 0 && (
                      <p dir="auto" className="text-[11px] text-[#8B9BB0] leading-relaxed break-words">
                        {item.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reactions Breakdown */}
          {post.reactions.length > 0 && (
            <div className="p-5 space-y-2.5">
              <div className="text-[13px] font-semibold text-[#5eb5f7]">
                {t.reactionsBreakdownTitle}
              </div>
              <div className="flex flex-wrap gap-3 text-xs font-mono-num">
                {post.reactions.map((r) => (
                  <span key={r.emoji} className="inline-flex items-center gap-1.5 text-[#f5f7fa]">
                    <span>{r.emoji}</span>
                    <span className="font-semibold">{r.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Post Views & Shares Trajectory Chart */}
          {details?.viewsGraph && (
            <div className="p-4">
              <TelegramTimeChart
                graph={details.viewsGraph}
                lang={lang}
                titleOverride={t.postTrendTitle}
                dualAxisHint={t.dualAxisViewsSharesHint}
                height={196}
                compact
                showRangeSlider={false}
              />
            </div>
          )}

          {/* Daily Views & Shares Activity Log */}
          {activeDailyRows.length > 0 && (
            <div className="p-5 space-y-2.5">
              <div className="text-[13px] font-semibold text-[#5eb5f7]">
                {t.dailyBreakdownTableTitle}
              </div>
              <div className="divide-y divide-white/[0.06] max-h-48 overflow-y-auto overscroll-contain border-t border-white/[0.06]">
                {visibleDailyRows.map((row) => (
                  <div
                    key={row.dateKey}
                    dir="ltr"
                    className="flex items-center justify-between py-2 text-xs font-mono-num"
                  >
                    <span className="text-[#8B9BB0]">{row.dateKey}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-[#4dcd5e]">{row.views.toLocaleString('en-US')} {t.viewsWord}</span>
                      <span className={row.shares > 0 ? 'text-[#f5a623] font-semibold' : 'text-[#8596AA]'}>
                        +{row.shares} {t.sharesWord}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {!showAllDaily && activeDailyRows.length > DRAWER_ROW_LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAllDaily(true)}
                  className="text-[11px] font-medium text-[#5EC2F6] hover:underline cursor-pointer"
                >
                  {lang === 'fa'
                    ? `نمایش همه ${activeDailyRows.length} روز`
                    : `Show all ${activeDailyRows.length} days`}
                </button>
              )}
            </div>
          )}

          {/* Public Forwards List */}
          <div className="p-5 space-y-2.5">
            <div className="text-[13px] font-semibold text-[#5eb5f7]">{t.publicForwardsTitle}</div>
            {forwardsList.length === 0 ? (
              <p className="text-xs text-[#7f91a4] leading-relaxed">{t.noPublicForwards}</p>
            ) : (
              <>
                <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                  {visibleForwards.map((fwd) => {
                    const fwdUrl = fwd.channelUsername
                      ? `https://t.me/${encodeURIComponent(fwd.channelUsername)}/${fwd.messageId}`
                      : null;
                    const inner = (
                      <>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#f5f7fa] truncate">
                            {fwd.channelTitle}
                            {fwd.channelUsername && (
                              <span dir="ltr" className="inline-block text-[#5eb5f7] font-mono-num ms-1.5">
                                @{fwd.channelUsername}
                              </span>
                            )}
                          </div>
                          <div dir="ltr" className="text-[11px] text-[#8B9BB0] font-mono-num mt-0.5 text-start">
                            {formatUtcDate(fwd.date, lang)} · #{fwd.messageId}
                          </div>
                        </div>
                        <div dir="ltr" className="flex items-center gap-2 shrink-0 text-xs font-mono-num text-[#4dcd5e]">
                          <span>{fwd.views.toLocaleString('en-US')} {t.viewsWord}</span>
                          {fwdUrl && <ExternalLink className="w-3.5 h-3.5 text-[#8B9BB0]" aria-hidden="true" />}
                        </div>
                      </>
                    );

                    return fwdUrl ? (
                      <a
                        key={`${fwd.channelId}-${fwd.messageId}`}
                        href={fwdUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-3 py-2.5 hover:bg-white/[0.03] rounded-md px-1 -mx-1 transition-colors"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div
                        key={`${fwd.channelId}-${fwd.messageId}`}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        {inner}
                      </div>
                    );
                  })}
                </div>
                {!showAllForwards && forwardsList.length > DRAWER_ROW_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllForwards(true)}
                    className="text-[11px] font-medium text-[#5EC2F6] hover:underline cursor-pointer"
                  >
                    {lang === 'fa'
                      ? `نمایش همه ${forwardsList.length} بازنشر عمومی`
                      : `Show all ${forwardsList.length} public forwards`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

PostDetailDrawer.displayName = 'PostDetailDrawer';
