import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageCode, ParsedStatsGraph } from '../../types/analytics';
import { computeAxisTicks, formatCompactNumber } from '../../utils/analyticsMath';

interface HourlyBreakdownChartProps {
  graph: ParsedStatsGraph;
  title: string;
  lang?: LanguageCode;
  timezoneOffsetMinutes?: number;
  timezoneLabel?: string;
}

export const HourlyBreakdownChart: React.FC<HourlyBreakdownChartProps> = React.memo(
  ({ graph, title, lang = 'fa', timezoneOffsetMinutes = 0, timezoneLabel = 'UTC' }) => {
    const primary = graph.series[0];
    const secondary = graph.series[1];
    const [hoverHour, setHoverHour] = useState<number | null>(null);
    const rafRef = useRef<number | null>(null);
    const pendingHourRef = useRef<number | null>(null);

    useEffect(() => {
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }, []);

    const rawValues = useMemo(() => primary?.values ?? [], [primary]);
    const rawSecondaryValues = useMemo(() => secondary?.values ?? [], [secondary]);
    const hourShift = Math.round(timezoneOffsetMinutes / 60);

    const values = useMemo(() => {
      if (rawValues.length !== 24 || hourShift === 0) return rawValues;
      return Array.from({ length: 24 }, (_, displayHour) => {
        const utcHour = (((displayHour - hourShift) % 24) + 24) % 24;
        return rawValues[utcHour] ?? 0;
      });
    }, [rawValues, hourShift]);

    const secondaryValues = useMemo(() => {
      if (rawSecondaryValues.length !== 24 || hourShift === 0) return rawSecondaryValues;
      return Array.from({ length: 24 }, (_, displayHour) => {
        const utcHour = (((displayHour - hourShift) % 24) + 24) % 24;
        return rawSecondaryValues[utcHour] ?? 0;
      });
    }, [rawSecondaryValues, hourShift]);
    const count = values.length;

    const { maxVal, peakIdx, yTicks, yMax } = useMemo(() => {
      if (values.length === 0) {
        return { maxVal: 0, peakIdx: 0, yTicks: [0, 1], yMax: 1 };
      }
      let peak = 0;
      let peakVal = -Infinity;
      let overallMax = 0;
      for (let i = 0; i < values.length; i += 1) {
        const v = values[i] ?? 0;
        const sv = secondaryValues[i] ?? 0;
        if (v > peakVal) {
          peakVal = v;
          peak = i;
        }
        if (v > overallMax) overallMax = v;
        if (sv > overallMax) overallMax = sv;
      }
      const safeMax = Math.max(1, overallMax);
      const ticks = computeAxisTicks(0, safeMax, 4);
      const topTick = Math.max(safeMax, ticks[ticks.length - 1] ?? safeMax);
      return { maxVal: overallMax, peakIdx: peak, yTicks: ticks, yMax: topTick };
    }, [values, secondaryValues]);

    const svgWidth = 760;
    const height = 200;
    const padLeft = 42;
    const padRight = 14;
    const padTop = 14;
    const padBottom = 30;
    const plotW = svgWidth - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const baselineY = padTop + plotH;
    const stepW = count > 0 ? plotW / count : plotW;
    const barWidth = Math.max(6, Math.min(24, stepW * 0.68));

    const getHourFromPointer = useCallback(
      (e: React.PointerEvent<SVGRectElement>): number | null => {
        if (count === 0) return null;
        const svg = e.currentTarget.ownerSVGElement;
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0) return null;
        const svgX = ((e.clientX - rect.left) / rect.width) * svgWidth;
        const raw = Math.floor((svgX - padLeft) / stepW);
        return Math.max(0, Math.min(count - 1, raw));
      },
      [count, stepW],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<SVGRectElement>) => {
        const idx = getHourFromPointer(e);
        if (idx === null) return;
        pendingHourRef.current = idx;
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            setHoverHour(pendingHourRef.current);
          });
        }
      },
      [getHourFromPointer],
    );

    const handlePointerLeave = useCallback(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingHourRef.current = null;
      setHoverHour(null);
    }, []);

    if (!primary || count === 0) {
      return (
        <section className="tg-panel rounded-xl p-5" aria-label={title}>
          <h3 className="text-[13px] font-semibold text-[#5eb5f7]">{title}</h3>
          <p className="text-xs text-[#7f91a4] mt-3">
            {lang === 'fa' ? 'داده‌ای برای ساعات اوج بازدید ثبت نشده است.' : 'No hourly activity data available yet.'}
          </p>
        </section>
      );
    }

    const peakLabel = `${String(peakIdx).padStart(2, '0')}:00 ${timezoneLabel}`;
    const peakCount = values[peakIdx] ?? 0;

    return (
      <section className="tg-panel rounded-xl p-4 sm:p-5" aria-label={title}>
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-[#5eb5f7]">{title}</h3>
            {secondary && (
              <span className="text-[10px] font-medium text-[#8B9BB0] border border-white/10 bg-[#0B0F14]/80 rounded px-1.5 py-0.5">
                {primary.label} / {secondary.label}
              </span>
            )}
          </div>
          <span className="text-xs text-[#8B9BB0] font-mono-num">
            {lang === 'fa' ? 'اوج بازدید:' : 'Peak:'}{' '}
            <span dir="ltr" className="inline-block">
              <strong className="text-[#5EC2F6] font-semibold">{peakLabel}</strong> (
              {peakCount.toLocaleString('en-US')})
            </span>
          </span>
        </div>

        <div className="relative select-none" dir="ltr">
          <svg
            viewBox={`0 0 ${svgWidth} ${height}`}
            className="w-full h-auto overflow-visible"
            role="img"
            aria-label={`${title} hourly bar chart`}
          >
            {/* Y-Axis Gridlines & Ticks */}
            <g pointerEvents="none">
              {yTicks.map((tick) => {
                const y = baselineY - (tick / (yMax || 1)) * plotH;
                const isZero = tick === 0;
                return (
                  <g key={`y-${tick}`}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke={isZero ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)'}
                      strokeWidth={1}
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      fill="#8596AA"
                      className="text-[10px] font-mono-num"
                    >
                      {formatCompactNumber(tick)}
                    </text>
                  </g>
                );
              })}

              {/* Hover Column Highlight */}
              {hoverHour !== null && (
                <rect
                  x={padLeft + hoverHour * stepW + 1}
                  y={padTop}
                  width={Math.max(4, stepW - 2)}
                  height={plotH}
                  rx={4}
                  fill="rgba(255, 255, 255, 0.04)"
                />
              )}

              {/* All 24 Hourly Bars Anchored Flush on Exact Baseline */}
              {values.map((val, hour) => {
                const centerX = padLeft + (hour + 0.5) * stepW;
                const isPeak = hour === peakIdx && maxVal > 0;
                const isHovered = hour === hoverHour;
                const rawH = val > 0 ? Math.max(4, (val / (yMax || 1)) * plotH) : 2;
                const barY = baselineY - rawH;

                const secVal = secondary ? (secondaryValues[hour] ?? 0) : 0;
                const secBarH = secVal > 0 ? Math.max(3, (secVal / (yMax || 1)) * plotH) : 0;
                const mainW = secondary ? Math.max(4, barWidth * 0.62) : barWidth;
                const secW = secondary ? Math.max(3, barWidth * 0.34) : 0;
                const mainX = secondary ? centerX - (mainW + secW + 2) / 2 : centerX - mainW / 2;
                const secX = mainX + mainW + 2;

                return (
                  <g key={`bar-${hour}`}>
                    <rect
                      x={mainX}
                      y={barY}
                      width={mainW}
                      height={rawH}
                      rx={2.5}
                      fill={
                        val === 0
                          ? 'rgba(51, 144, 236, 0.16)'
                          : isPeak
                            ? isHovered
                              ? '#5EC2F6'
                              : '#2AABEE'
                            : isHovered
                              ? 'rgba(94, 194, 246, 0.78)'
                              : 'rgba(42, 171, 238, 0.38)'
                      }
                    />
                    {secondary && secBarH > 0 && (
                      <rect
                        x={secX}
                        y={baselineY - secBarH}
                        width={secW}
                        height={secBarH}
                        rx={1.5}
                        fill={secondary.color || '#8B9BB0'}
                        opacity={isHovered ? 0.9 : 0.45}
                      />
                    )}
                  </g>
                );
              })}

              {/* X-Axis Hour Ticks & Labels (Strictly Below Baseline) */}
              {values.map((_, hour) => {
                const showLabel = hour % 3 === 0 || hour === count - 1;
                if (!showLabel) return null;
                const centerX = padLeft + (hour + 0.5) * stepW;
                const isHighlighted = hour === hoverHour || (hour === peakIdx && maxVal > 0);
                return (
                  <g key={`x-${hour}`}>
                    <line
                      x1={centerX}
                      y1={baselineY}
                      x2={centerX}
                      y2={baselineY + 4}
                      stroke="rgba(255,255,255,0.16)"
                      strokeWidth={1}
                    />
                    <text
                      x={centerX}
                      y={height - 8}
                      textAnchor="middle"
                      className={`text-[10px] font-mono-num ${
                        isHighlighted ? 'fill-[#5EC2F6] font-semibold' : 'fill-[#8596AA]'
                      }`}
                    >
                      {String(hour).padStart(2, '0')}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* Single O(1) Interactive Hitbox */}
            <rect
              x={padLeft}
              y={padTop}
              width={Math.max(1, plotW)}
              height={plotH + 22}
              fill="transparent"
              className="cursor-crosshair"
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            />
          </svg>

          {/* Crisp Hover Tooltip */}
          {hoverHour !== null && (
            <div
              className={`pointer-events-none absolute top-2 tg-tooltip-glass rounded-xl px-3 py-2 ${
                hoverHour >= Math.floor(count / 2) ? 'left-12' : 'right-2'
              }`}
              style={{ minWidth: 148 }}
            >
              <div className="text-[11px] font-medium text-[#7f91a4] font-mono-num mb-1">
                {String(hoverHour).padStart(2, '0')}:00 {timezoneLabel}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-[#f5f7fa]">{primary.label}</span>
                  <span className="font-mono-num font-semibold text-[#5EC2F6]">
                    {(values[hoverHour] ?? 0).toLocaleString('en-US')}
                  </span>
                </div>
                {secondary && (
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-[#8B9BB0]">{secondary.label}</span>
                    <span
                      className="font-mono-num font-semibold"
                      style={{ color: secondary.color || '#8B9BB0' }}
                    >
                      {(secondaryValues[hoverHour] ?? 0).toLocaleString('en-US')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  },
);

HourlyBreakdownChart.displayName = 'HourlyBreakdownChart';
