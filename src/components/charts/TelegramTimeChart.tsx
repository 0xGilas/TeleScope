import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { LanguageCode, ParsedStatsGraph, StatsSeriesLine } from '../../types/analytics';
import { getTranslations } from '../../i18n/translations';
import {
  computeAxisTicks,
  formatCompactNumber,
  formatDateKey,
  resolveDualAxisPlan,
} from '../../utils/analyticsMath';

interface TelegramTimeChartProps {
  graph: ParsedStatsGraph;
  lang?: LanguageCode;
  titleOverride?: string;
  subtitle?: string;
  dualAxisHint?: string;
  selectedDateKey?: string | null;
  onSelectDate?: (dateKey: string) => void;
  height?: number;
  showRangeSlider?: boolean;
  compact?: boolean;
}

function formatAxisDate(ts: number, lang: LanguageCode = 'en'): string {
  const d = new Date(ts);
  return d.toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function getSeriesBounds(
  seriesList: StatsSeriesLine[],
  visibleIndices: number[],
  graphType: ParsedStatsGraph['type'],
  forceZeroMin: boolean,
): { minVal: number; maxVal: number } {
  let max = 1;
  let min = 0;

  if (graphType === 'stacked_bar') {
    for (const idx of visibleIndices) {
      const sum = seriesList.reduce((acc, s) => acc + (s.values[idx] ?? 0), 0);
      if (sum > max) max = sum;
    }
    return { minVal: 0, maxVal: max };
  }

  let foundAny = false;
  for (const s of seriesList) {
    for (const idx of visibleIndices) {
      const v = s.values[idx] ?? 0;
      if (!foundAny) {
        max = v;
        min = v;
        foundAny = true;
      } else {
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
  }

  if (forceZeroMin || graphType === 'bar' || min > 0) {
    min =
      !forceZeroMin && seriesList.length === 1 && min > 10
        ? Math.floor(min * 0.92)
        : 0;
  }
  if (max <= min) max = min + 1;
  return { minVal: min, maxVal: max };
}

export const TelegramTimeChart: React.FC<TelegramTimeChartProps> = React.memo(
  ({
    graph,
    lang = 'en',
    titleOverride,
    subtitle,
    dualAxisHint,
    selectedDateKey,
    onSelectDate,
    height = 240,
    showRangeSlider = true,
    compact = false,
  }) => {
    const t = getTranslations(lang);
    const chartTitle = titleOverride ?? graph.title;
    const totalPoints = graph.timestamps.length;
    const [rangeStart, setRangeStart] = useState(0);
    const [rangeEnd, setRangeEnd] = useState(() => Math.max(0, totalPoints - 1));
    const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const hoverRafRef = useRef<number | null>(null);
    const pendingHoverRef = useRef<number | null>(null);

    // Reset slider bounds when switching channels or loading a fresh graph range
    useEffect(() => {
      setRangeStart(0);
      setRangeEnd(Math.max(0, totalPoints - 1));
      setHoverIdx(null);
    }, [graph.id, totalPoints]);

    useEffect(() => {
      return () => {
        if (hoverRafRef.current !== null) {
          cancelAnimationFrame(hoverRafRef.current);
        }
      };
    }, []);

    const clampedStart =
      totalPoints <= 1 ? 0 : Math.max(0, Math.min(rangeStart, totalPoints - 2));
    const clampedEnd =
      totalPoints <= 1
        ? Math.max(0, totalPoints - 1)
        : Math.max(clampedStart + 1, Math.min(rangeEnd, totalPoints - 1));

    const visibleIndices = useMemo(() => {
      if (totalPoints === 0) return [];
      const arr: number[] = [];
      for (let i = clampedStart; i <= clampedEnd; i += 1) {
        arr.push(i);
      }
      return arr;
    }, [totalPoints, clampedStart, clampedEnd]);

    const activeSeries = useMemo(
      () => graph.series.filter((s) => !hiddenSeries[s.key]),
      [graph.series, hiddenSeries],
    );

    const dualAxisPlan = useMemo(
      () => resolveDualAxisPlan(activeSeries, graph.type, visibleIndices, graph.yScaled),
      [activeSeries, graph.type, visibleIndices, graph.yScaled],
    );

    const isDualAxis = dualAxisPlan.isDualAxis;
    const rightSeriesIdx = dualAxisPlan.rightSeriesIndices[0] ?? -1;
    const leftSeriesIdx = dualAxisPlan.leftSeriesIndices[0] ?? 0;

    const { leftMin, leftMax, rightMin, rightMax, leftTicks, rightTicks } = useMemo(() => {
      if (isDualAxis && rightSeriesIdx !== -1) {
        const leftList = dualAxisPlan.leftSeriesIndices
          .map((i) => activeSeries[i])
          .filter(Boolean);
        const rightList = dualAxisPlan.rightSeriesIndices
          .map((i) => activeSeries[i])
          .filter(Boolean);
        const left = getSeriesBounds(leftList, visibleIndices, graph.type, true);
        const right = getSeriesBounds(rightList, visibleIndices, graph.type, true);
        return {
          leftMin: left.minVal,
          leftMax: left.maxVal,
          rightMin: right.minVal,
          rightMax: right.maxVal,
          leftTicks: computeAxisTicks(left.minVal, left.maxVal, 4),
          rightTicks: computeAxisTicks(right.minVal, right.maxVal, 4),
        };
      }

      const unified = getSeriesBounds(activeSeries, visibleIndices, graph.type, false);
      return {
        leftMin: unified.minVal,
        leftMax: unified.maxVal,
        rightMin: unified.minVal,
        rightMax: unified.maxVal,
        leftTicks: computeAxisTicks(unified.minVal, unified.maxVal, 4),
        rightTicks: [] as number[],
      };
    }, [isDualAxis, rightSeriesIdx, dualAxisPlan, activeSeries, visibleIndices, graph.type]);

    const svgWidth = compact ? 480 : 760;
    const padLeft = compact ? 42 : 48;
    const padRight = isDualAxis ? (compact ? 38 : 46) : 16;
    const padTop = isDualAxis ? 24 : 16;
    const padBottom = 30;
    const plotW = svgWidth - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const getX = useCallback(
      (localIdx: number) => {
        if (visibleIndices.length <= 1) return padLeft + plotW / 2;
        return padLeft + (localIdx / (visibleIndices.length - 1)) * plotW;
      },
      [visibleIndices.length, padLeft, plotW],
    );

    const getY = useCallback(
      (val: number, seriesIdx = 0) => {
        const useRight = isDualAxis && dualAxisPlan.rightSeriesIndices.includes(seriesIdx);
        const min = useRight ? rightMin : leftMin;
        const max = useRight ? rightMax : leftMax;
        const ratio = (val - min) / (max - min || 1);
        return padTop + plotH - ratio * plotH;
      },
      [isDualAxis, dualAxisPlan.rightSeriesIndices, rightMin, leftMin, rightMax, leftMax, padTop, plotH],
    );

    const toggleSeries = (key: string) => {
      setHiddenSeries((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        const remaining = graph.series.filter((s) => !next[s.key]);
        if (remaining.length === 0) return prev;
        return next;
      });
    };

    const resolveLocalIdxFromPointer = useCallback(
      (e: React.PointerEvent<SVGRectElement> | React.MouseEvent<SVGRectElement>) => {
        if (visibleIndices.length <= 1) return 0;
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        return Math.round(relX * (visibleIndices.length - 1));
      },
      [visibleIndices.length],
    );

    const handleOverlayPointerMove = useCallback(
      (e: React.PointerEvent<SVGRectElement>) => {
        const idx = resolveLocalIdxFromPointer(e);
        pendingHoverRef.current = idx;
        if (hoverRafRef.current !== null) return;
        hoverRafRef.current = requestAnimationFrame(() => {
          hoverRafRef.current = null;
          const nextIdx = pendingHoverRef.current;
          setHoverIdx((prev) => (prev === nextIdx ? prev : nextIdx));
        });
      },
      [resolveLocalIdxFromPointer],
    );

    const handleOverlayPointerLeave = useCallback(() => {
      pendingHoverRef.current = null;
      if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      setHoverIdx(null);
    }, []);

    const handleOverlayClick = useCallback(
      (e: React.MouseEvent<SVGRectElement>) => {
        if (!onSelectDate || visibleIndices.length === 0) return;
        const localIdx = resolveLocalIdxFromPointer(e);
        const globalIdx = visibleIndices[localIdx];
        if (globalIdx !== undefined && graph.timestamps[globalIdx] !== undefined) {
          onSelectDate(formatDateKey(graph.timestamps[globalIdx]));
        }
      },
      [onSelectDate, visibleIndices, resolveLocalIdxFromPointer, graph.timestamps],
    );

    const handleChartKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (visibleIndices.length === 0) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const delta = e.key === 'ArrowRight' ? 1 : -1;
          setHoverIdx((prev) => {
            const base = prev === null ? (delta > 0 ? 0 : visibleIndices.length - 1) : prev + delta;
            return Math.max(0, Math.min(visibleIndices.length - 1, base));
          });
        } else if ((e.key === 'Enter' || e.key === ' ') && onSelectDate && hoverIdx !== null) {
          const globalIdx = visibleIndices[hoverIdx];
          if (globalIdx !== undefined && graph.timestamps[globalIdx] !== undefined) {
            e.preventDefault();
            onSelectDate(formatDateKey(graph.timestamps[globalIdx]));
          }
        } else if (e.key === 'Escape') {
          setHoverIdx(null);
        }
      },
      [visibleIndices, onSelectDate, hoverIdx, graph.timestamps],
    );

    // Memoize static polylines / bars separately from hoverIdx so pointer scrubbing stays 60fps
    const staticSeriesLayer = useMemo(() => {
      if (graph.type === 'bar' || graph.type === 'stacked_bar') {
        return visibleIndices.map((globalIdx, localIdx) => {
          const slotWidth = Math.max(8, Math.min(34, plotW / visibleIndices.length - 8));
          const centerX = getX(localIdx);

          if (graph.type === 'stacked_bar') {
            let accY = padTop + plotH;
            return (
              <g key={globalIdx}>
                {activeSeries.map((s) => {
                  const val = s.values[globalIdx] ?? 0;
                  const barH = (val / (leftMax || 1)) * plotH;
                  accY -= barH;
                  return (
                    <rect
                      key={s.key}
                      x={centerX - slotWidth / 2}
                      y={accY}
                      width={slotWidth}
                      height={Math.max(0, barH)}
                      fill={s.color}
                      opacity={0.9}
                    />
                  );
                })}
              </g>
            );
          }

          const subWidth = slotWidth / Math.max(1, activeSeries.length);
          return (
            <g key={globalIdx}>
              {activeSeries.map((s, sIdx) => {
                const val = s.values[globalIdx] ?? 0;
                const y = getY(val, sIdx);
                const barH = Math.max(2, padTop + plotH - y);
                return (
                  <rect
                    key={s.key}
                    x={centerX - slotWidth / 2 + sIdx * subWidth}
                    y={y}
                    width={Math.max(3, subWidth - 2)}
                    height={barH}
                    rx={2}
                    fill={s.color}
                    opacity={0.92}
                  />
                );
              })}
            </g>
          );
        });
      }

      return activeSeries.map((s, sIdx) => {
        const points = visibleIndices
          .map((globalIdx, localIdx) => `${getX(localIdx)},${getY(s.values[globalIdx] ?? 0, sIdx)}`)
          .join(' ');
        return (
          <g key={s.key}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points}
            />
            {visibleIndices.map((globalIdx, localIdx) => {
              const dateKey = formatDateKey(graph.timestamps[globalIdx]);
              const isSelected = selectedDateKey === dateKey;
              if (!isSelected && visibleIndices.length > 16) return null;
              return (
                <circle
                  key={`${s.key}-${globalIdx}`}
                  cx={getX(localIdx)}
                  cy={getY(s.values[globalIdx] ?? 0, sIdx)}
                  r={isSelected ? 4.25 : 2.6}
                  fill="#090C10"
                  stroke={s.color}
                  strokeWidth={2}
                />
              );
            })}
          </g>
        );
      });
    }, [
      graph.type,
      graph.timestamps,
      visibleIndices,
      activeSeries,
      selectedDateKey,
      plotW,
      plotH,
      padTop,
      leftMax,
      getX,
      getY,
    ]);

    if (totalPoints === 0) {
      return (
        <div className="tg-panel rounded-xl p-5">
          <div className="text-[13px] font-semibold text-[#5eb5f7]">{chartTitle}</div>
          <div className="mt-3 text-xs text-[#8B9BB0]">
            {graph.error || t.noChartDataMsg}
          </div>
        </div>
      );
    }

    const activeHoverGlobalIdx =
      hoverIdx !== null && visibleIndices[hoverIdx] !== undefined ? visibleIndices[hoverIdx] : null;
    const leftSeries = activeSeries[leftSeriesIdx];
    const rightSeries = rightSeriesIdx !== -1 ? activeSeries[rightSeriesIdx] : undefined;

    return (
      <section className="tg-panel rounded-xl p-4 sm:p-5" aria-label={chartTitle}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold text-[#5eb5f7]">{chartTitle}</h3>
              {isDualAxis && dualAxisHint && (
                <span className="text-[10px] font-medium text-[#8B9BB0] border border-white/10 bg-[#0B0F14]/80 rounded px-1.5 py-0.5">
                  {dualAxisHint}
                </span>
              )}
            </div>
            {subtitle && <p className="text-xs text-[#7f91a4] mt-0.5">{subtitle}</p>}
          </div>
          <div dir="ltr" className="text-xs text-[#8B9BB0] font-mono-num">
            {formatAxisDate(graph.timestamps[clampedStart], lang)}
            {clampedEnd !== clampedStart ? ` — ${formatAxisDate(graph.timestamps[clampedEnd], lang)}` : ''}
          </div>
        </div>

        <div
          className="relative select-none rounded-lg focus-visible:outline-2 focus-visible:outline-[#2AABEE]"
          dir="ltr"
          tabIndex={0}
          role="application"
          aria-label={`${chartTitle} interactive chart`}
          onKeyDown={handleChartKeyDown}
        >
          <svg
            viewBox={`0 0 ${svgWidth} ${height}`}
            className="w-full h-auto overflow-visible"
            role="img"
            aria-label={`${chartTitle} interactive chart`}
          >
            {/* Axis Labels for Dual Axis */}
            {isDualAxis && leftSeries && rightSeries && (
              <g pointerEvents="none">
                <text
                  x={padLeft - 8}
                  y={11}
                  textAnchor="end"
                  className="text-[9.5px] font-semibold uppercase tracking-wider"
                  fill={leftSeries.color}
                >
                  {leftSeries.label}
                </text>
                <text
                  x={svgWidth - padRight + 8}
                  y={11}
                  textAnchor="start"
                  className="text-[9.5px] font-semibold uppercase tracking-wider"
                  fill={rightSeries.color}
                >
                  {rightSeries.label}
                </text>
              </g>
            )}

            {/* Left Y-Axis Ticks & Horizontal Grid Lines */}
            <g pointerEvents="none">
              {leftTicks.map((tick, i) => {
                const y = getY(tick, leftSeriesIdx);
                return (
                  <g key={`l-${i}-${tick}`}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth={1}
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill={isDualAxis && leftSeries ? leftSeries.color : '#8596AA'}
                      className="text-[10px] font-mono-num opacity-95"
                    >
                      {formatCompactNumber(tick)}
                    </text>
                  </g>
                );
              })}

              {/* Independent Right Y-Axis Ticks (e.g. Shares separated from Views) */}
              {isDualAxis &&
                rightSeries &&
                rightTicks.map((tick, i) => {
                  const y = getY(tick, rightSeriesIdx);
                  return (
                    <text
                      key={`r-${i}-${tick}`}
                      x={svgWidth - padRight + 8}
                      y={y + 4}
                      textAnchor="start"
                      fill={rightSeries.color}
                      className="text-[10px] font-mono-num font-semibold opacity-95"
                    >
                      {formatCompactNumber(tick)}
                    </text>
                  );
                })}

              {/* Selected Date Vertical Highlight */}
              {selectedDateKey &&
                visibleIndices.map((globalIdx, localIdx) => {
                  if (formatDateKey(graph.timestamps[globalIdx]) !== selectedDateKey) return null;
                  const x = getX(localIdx);
                  return (
                    <g key={`sel-${globalIdx}`}>
                      <rect
                        x={x - 14}
                        y={padTop}
                        width={28}
                        height={plotH}
                        rx={6}
                        fill="rgba(245, 166, 35, 0.12)"
                      />
                      <line
                        x1={x}
                        y1={padTop}
                        x2={x}
                        y2={padTop + plotH}
                        stroke="#f5a623"
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                      />
                    </g>
                  );
                })}

              {/* Memoized Lines / Bars */}
              {staticSeriesLayer}

              {/* Lightweight Interactive Hover Crosshair & Active Dots */}
              {hoverIdx !== null && visibleIndices[hoverIdx] !== undefined && (
                <g>
                  <line
                    x1={getX(hoverIdx)}
                    y1={padTop}
                    x2={getX(hoverIdx)}
                    y2={padTop + plotH}
                    stroke="rgba(255,255,255,0.22)"
                    strokeWidth={1}
                  />
                  {graph.type !== 'bar' &&
                    graph.type !== 'stacked_bar' &&
                    activeSeries.map((s, sIdx) => {
                      const globalIdx = visibleIndices[hoverIdx];
                      return (
                        <circle
                          key={`hover-${s.key}`}
                          cx={getX(hoverIdx)}
                          cy={getY(s.values[globalIdx] ?? 0, sIdx)}
                          r={4.5}
                          fill="#090C10"
                          stroke={s.color}
                          strokeWidth={2.25}
                        />
                      );
                    })}
                </g>
              )}

              {/* X Axis Labels */}
              {visibleIndices.map((globalIdx, localIdx) => {
                const maxLabels = compact ? 5 : 7;
                const step = visibleIndices.length > maxLabels ? Math.ceil(visibleIndices.length / maxLabels) : 1;
                if (localIdx % step !== 0 && localIdx !== visibleIndices.length - 1) return null;
                const dateKey = formatDateKey(graph.timestamps[globalIdx]);
                const isSelected = selectedDateKey === dateKey;
                return (
                  <text
                    key={`x-${globalIdx}`}
                    x={getX(localIdx)}
                    y={height - 8}
                    textAnchor="middle"
                    className={`text-[10px] font-mono-num ${
                      isSelected ? 'fill-[#f5a623] font-semibold' : 'fill-[#8596AA]'
                    }`}
                  >
                    {formatAxisDate(graph.timestamps[globalIdx], lang)}
                  </text>
                );
              })}
            </g>

            {/* Single O(1) Interactive Hitbox Layer (eliminates N per-day SVG DOM nodes) */}
            <rect
              x={padLeft}
              y={padTop}
              width={Math.max(1, plotW)}
              height={plotH + 22}
              fill="transparent"
              className={onSelectDate ? 'cursor-pointer' : 'cursor-crosshair'}
              onPointerMove={handleOverlayPointerMove}
              onPointerLeave={handleOverlayPointerLeave}
              onClick={handleOverlayClick}
            />
          </svg>

          {/* Floating Tooltip (flips side automatically so right-edge points & right Y-axis stay unobstructed) */}
          {activeHoverGlobalIdx !== null && (
            <div
              className={`pointer-events-none absolute top-2 tg-tooltip-glass rounded-xl px-3 py-2 transition-[left,right] duration-75 ${
                hoverIdx !== null && hoverIdx >= Math.floor(visibleIndices.length / 2)
                  ? 'left-12'
                  : 'right-2'
              }`}
              style={{ minWidth: 152 }}
            >
              <div className="text-[11px] font-medium text-[#8B9BB0] font-mono-num mb-1">
                {formatAxisDate(graph.timestamps[activeHoverGlobalIdx], lang)}
              </div>
              <div className="space-y-1">
                {activeSeries.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-[#f5f7fa]">{s.label}</span>
                    <span className="font-mono-num font-semibold" style={{ color: s.color }}>
                      {(s.values[activeHoverGlobalIdx] ?? 0).toLocaleString('en-US')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Telegram-style Range Slider */}
        {showRangeSlider && totalPoints > 4 && (
          <div className="mt-2 pt-2.5 border-t border-white/[0.06] flex items-center gap-3" dir="ltr">
            <span className="text-[11px] text-[#8596AA] whitespace-nowrap">{t.rangeLabel}</span>
            <input
              type="range"
              aria-label={`${chartTitle} start range`}
              min={0}
              max={Math.max(0, totalPoints - 2)}
              value={clampedStart}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRangeStart(Math.min(v, clampedEnd - 1));
              }}
              className="w-full accent-[#3390ec] h-1 bg-[#111923] rounded-lg cursor-pointer"
            />
            <input
              type="range"
              aria-label={`${chartTitle} end range`}
              min={1}
              max={Math.max(1, totalPoints - 1)}
              value={clampedEnd}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRangeEnd(Math.max(v, clampedStart + 1));
              }}
              className="w-full accent-[#3390ec] h-1 bg-[#111923] rounded-lg cursor-pointer"
            />
          </div>
        )}

        {/* Native Telegram Series Toggle Chips + Clickable Share Dates */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {graph.series.map((s) => {
              const active = !hiddenSeries[s.key];
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSeries(s.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'text-[#0e1621]'
                      : 'border border-white/10 bg-transparent text-[#7f91a4] hover:text-[#f5f7fa]'
                  }`}
                  style={active ? { backgroundColor: s.color } : undefined}
                >
                  {active && <Check className="w-3 h-3 stroke-[2.5]" />}
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>

          {onSelectDate && (
            <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
              {visibleIndices
                .filter((idx) => {
                  const shareSeries =
                    graph.series.find((s) => /share|forward/i.test(s.label)) ?? graph.series[1];
                  return shareSeries && (shareSeries.values[idx] ?? 0) > 0;
                })
                .map((idx) => {
                  const dateKey = formatDateKey(graph.timestamps[idx]);
                  const shareSeries =
                    graph.series.find((s) => /share|forward/i.test(s.label)) ?? graph.series[1];
                  const sharesVal = shareSeries?.values[idx] ?? 0;
                  const isSelected = selectedDateKey === dateKey;
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      onClick={() => onSelectDate(dateKey)}
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-mono-num transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isSelected
                          ? 'border-[#f5a623] bg-[#f5a623]/15 text-[#f5a623]'
                          : 'border-white/[0.08] bg-[#111923] text-[#7f91a4] hover:text-[#f5f7fa]'
                      }`}
                    >
                      {formatAxisDate(graph.timestamps[idx], lang)}: +{sharesVal}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </section>
    );
  },
);

TelegramTimeChart.displayName = 'TelegramTimeChart';
