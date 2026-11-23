import React, { useMemo } from 'react';
import type { ChannelAnalyticsBundle, LanguageCode, TimezoneMode } from '../../types/analytics';
import { getTranslations } from '../../i18n/translations';
import {
  computeFormatInsights,
  computeWeekdayHourMatrix,
  formatCompactNumber,
  getTimezoneBadgeLabel,
  getTimezoneOffsetMinutes,
} from '../../utils/analyticsMath';
import { HourlyBreakdownChart } from '../charts/HourlyBreakdownChart';
import { TelegramTimeChart } from '../charts/TelegramTimeChart';

interface AudienceTabProps {
  lang: LanguageCode;
  bundle: ChannelAnalyticsBundle;
  timezoneMode: TimezoneMode;
  onChangeTimezoneMode: (mode: TimezoneMode) => void;
}

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const HOUR_SLOTS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];

export const AudienceTab: React.FC<AudienceTabProps> = React.memo(({
  lang,
  bundle,
  timezoneMode,
  onChangeTimezoneMode,
}) => {
  const t = getTranslations(lang);
  const { overview, posts } = bundle;
  const insights = useMemo(() => computeFormatInsights(posts), [posts]);
  const tzOffsetMinutes = useMemo(() => getTimezoneOffsetMinutes(timezoneMode), [timezoneMode]);
  const tzLabel = useMemo(() => getTimezoneBadgeLabel(timezoneMode), [timezoneMode]);
  const matrix = useMemo(
    () => computeWeekdayHourMatrix(posts, tzOffsetMinutes),
    [posts, tzOffsetMinutes],
  );

  const maxShareRate = useMemo(
    () => Math.max(0.5, ...matrix.map((c) => c.avgShareRate)),
    [matrix],
  );

  const goldenCell = useMemo(() => {
    const populated = matrix.filter((c) => c.postCount > 0);
    if (populated.length === 0) return null;
    return populated.sort((a, b) => b.avgShareRate - a.avgShareRate || b.avgViews - a.avgViews)[0];
  }, [matrix]);

  const langSlices = useMemo(() => {
    const g = overview.languagesGraph;
    if (!g || g.series.length === 0) return [];

    // Sum across all time points for each language series (Telegram contest specification for distribution)
    const seriesTotals = g.series.map((s) => ({
      label: s.label,
      color: s.color,
      value: s.values.reduce((acc, v) => acc + (v || 0), 0),
    }));

    const total = seriesTotals.reduce((acc, s) => acc + s.value, 0);

    // If total sum is 0 (or no data), fallback to the latest available timestamp
    if (total <= 0) {
      const lastIdx = Math.max(0, (g.timestamps.length || 1) - 1);
      const fallback = g.series.map((s) => ({
        label: s.label,
        color: s.color,
        value: s.values[lastIdx] ?? 0,
      }));
      const fbTotal = fallback.reduce((acc, s) => acc + s.value, 0) || 1;
      return fallback
        .map((s) => {
          const rawPct = (s.value / fbTotal) * 100;
          const pct = rawPct >= 10 ? Math.round(rawPct) : Number(rawPct.toFixed(1));
          return { ...s, pct };
        })
        .filter((s) => s.value > 0 || fallback.length <= 4)
        .sort((a, b) => b.pct - a.pct || b.value - a.value);
    }

    return seriesTotals
      .map((s) => {
        const rawPct = (s.value / total) * 100;
        const pct = rawPct >= 10 ? Math.round(rawPct) : Number(rawPct.toFixed(1));
        return { ...s, pct };
      })
      .filter((s) => s.value > 0)
      .sort((a, b) => b.pct - a.pct || b.value - a.value);
  }, [overview.languagesGraph]);

  const weekdayLabels = lang === 'fa' ? WEEKDAYS_FA : WEEKDAYS_EN;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-xs text-[#8B9BB0]">
          {lang === 'fa' ? 'منطقه زمانی نمایش ساعات:' : 'Display Timezone:'}
        </span>
        <div className="inline-flex items-center gap-1 rounded-lg bg-[#0B0F14] p-1 border border-white/[0.08]">
          {(
            [
              { id: 'iran', label: t.tzIranLabel },
              { id: 'local', label: t.tzLocalLabel },
              { id: 'utc', label: t.tzUtcLabel },
            ] as const
          ).map((opt) => {
            const active = timezoneMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeTimezoneMode(opt.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#2AABEE] text-[#090C10] font-semibold'
                    : 'text-[#8B9BB0] hover:text-[#F0F4F8]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {overview.topHoursGraph && (
        <HourlyBreakdownChart
          graph={overview.topHoursGraph}
          title={t.topHoursTitle}
          lang={lang}
          timezoneOffsetMinutes={tzOffsetMinutes}
          timezoneLabel={tzLabel}
        />
      )}

      {/* 7x6 Weekday x 4h Posting Performance Matrix */}
      <section className="tg-panel rounded-xl p-5 space-y-4" aria-label={t.heatmapTitle}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold text-[#5eb5f7]">{t.heatmapTitle}</h3>
              <span className="text-[10px] font-medium text-[#8B9BB0] border border-white/10 bg-[#0B0F14]/80 rounded px-1.5 py-0.5">
                {tzLabel}
              </span>
            </div>
            <p className="text-xs text-[#8B9BB0] mt-0.5">{t.heatmapSub}</p>
          </div>
          {goldenCell && (
            <div className="text-xs">
              <span className="text-[#7f91a4]">{t.goldenWindowLabel}: </span>
              <span className="font-semibold text-[#4dcd5e]">
                {weekdayLabels[goldenCell.weekday]}{' '}
                <span dir="ltr" className="font-mono-num">
                  {HOUR_SLOTS[goldenCell.hourBlock]} {tzLabel} ({goldenCell.avgShareRate}%)
                </span>
              </span>
            </div>
          )}
        </div>

        <div className="sm:hidden flex items-center justify-center gap-1.5 py-1 text-[11px] text-[#8B9BB0] bg-white/[0.02] rounded-lg border border-white/[0.05]">
          <span>{t.mobileSwipeHint}</span>
        </div>
        <div className="overflow-x-auto pb-1 -mx-2 px-2 sm:mx-0 sm:px-0" dir="ltr">
          <div className="min-w-[540px] space-y-1.5">
            <div className="grid grid-cols-7 gap-1.5 text-[11px] font-mono-num text-[#7f91a4]">
              <div />
              {HOUR_SLOTS.map((slot) => (
                <div key={slot} className="text-center py-1">
                  {slot}
                </div>
              ))}
            </div>

            {weekdayLabels.map((dayLabel, weekday) => (
              <div key={dayLabel} className="grid grid-cols-7 gap-1.5 items-center">
                <div className="text-xs font-medium text-[#7f91a4] pe-2 text-end">
                  {dayLabel}
                </div>
                {HOUR_SLOTS.map((slot, hourBlock) => {
                  const cell = matrix[weekday * 6 + hourBlock];
                  const count = cell?.postCount ?? 0;
                  const rate = cell?.avgShareRate ?? 0;
                  const intensity = count > 0 ? Math.max(0.18, rate / maxShareRate) : 0;
                  const isGolden =
                    goldenCell &&
                    goldenCell.weekday === weekday &&
                    goldenCell.hourBlock === hourBlock;

                  return (
                    <div
                      key={`${weekday}-${hourBlock}`}
                      title={
                        count > 0
                          ? `${dayLabel} ${slot} ${tzLabel}: ${count} post(s), ${rate}% avg share rate, ${cell?.avgViews} avg views`
                          : `${dayLabel} ${slot} ${tzLabel}: no posts`
                      }
                      className={`h-11 rounded-lg border flex flex-col items-center justify-center font-mono-num transition-colors ${
                        isGolden
                          ? 'border-[#4dcd5e]'
                          : count > 0
                            ? 'border-white/12'
                            : 'border-white/[0.04] bg-[#111923]/60'
                      }`}
                      style={
                        count > 0
                          ? { backgroundColor: `rgba(51, 144, 236, ${Math.min(0.6, intensity * 0.6)})` }
                          : undefined
                      }
                    >
                      {count > 0 ? (
                        <>
                          <span className="text-[11px] font-semibold text-[#f5f7fa]">
                            {rate}%
                          </span>
                          <span className="text-[10px] text-[#f5f7fa]/75">
                            {formatCompactNumber(cell?.avgViews ?? 0)} ({count})
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-[#8596AA]">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {overview.viewsBySourceGraph && (
          <TelegramTimeChart
            graph={overview.viewsBySourceGraph}
            lang={lang}
            titleOverride={t.viewsBySourceTitle}
            height={220}
            showRangeSlider={false}
          />
        )}

        {/* Languages Distribution */}
        <section className="tg-panel rounded-xl p-5 space-y-4">
          <h3 className="text-[13px] font-semibold text-[#5eb5f7]">
            {lang === 'fa' ? 'زبان مخاطبان کانال' : 'Subscriber Languages'}
          </h3>
          {langSlices.length === 0 ? (
            <p className="text-xs text-[#8B9BB0]">{t.noLanguageDataMsg}</p>
          ) : (
            <div className="space-y-3">
              {langSlices.map((slice) => (
                <div key={slice.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#f5f7fa] font-medium">{slice.label}</span>
                    <span className="font-mono-num text-[#7f91a4]">{slice.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${slice.pct}%`, backgroundColor: slice.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Content Format Efficiency Table */}
      <section className="tg-panel rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-[#5eb5f7]">{t.formatInsightsTitle}</h3>
          <p className="text-xs text-[#7f91a4] mt-0.5">{t.formatInsightsSub}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] bg-[#111923]/60 text-[11px] font-semibold text-[#8B9BB0]">
                <th className="py-2.5 px-5 text-start">{t.formatCol}</th>
                <th className="py-2.5 px-4 text-end">{t.postsCol}</th>
                <th className="py-2.5 px-4 text-end">{t.avgViewsCol}</th>
                <th className="py-2.5 px-4 text-end">{t.avgSharesCol}</th>
                <th className="py-2.5 px-5 text-end">{t.avgShareRateCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {insights.map((row) => (
                <tr key={row.mediaKind} className="hover:bg-white/[0.03]">
                  <td className="py-2.5 px-5 text-xs font-semibold text-[#f5f7fa] capitalize">
                    {row.mediaKind}
                  </td>
                  <td className="py-2.5 px-4 text-end text-xs text-[#7f91a4] font-mono-num">
                    {row.postCount}
                  </td>
                  <td className="py-2.5 px-4 text-end text-xs text-[#f5f7fa] font-mono-num">
                    {row.avgViews.toLocaleString('en-US')}
                  </td>
                  <td className="py-2.5 px-4 text-end text-xs text-[#f5a623] font-mono-num">
                    {row.avgShares}
                  </td>
                  <td className="py-2.5 px-5 text-end text-xs text-[#4dcd5e] font-mono-num font-semibold">
                    {row.avgShareRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
});

AudienceTab.displayName = 'AudienceTab';
