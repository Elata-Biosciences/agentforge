import { Component, useEffect, useRef, type ReactNode } from 'react';
import { ColorType, LineSeries, createChart } from 'lightweight-charts';

class ChartErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return this.props.fallback ?? <div className="h-[280px] w-full flex items-center justify-center text-xs text-muted-foreground font-mono">chart_render_error</div>;
    return this.props.children;
  }
}

function LightweightLineInner({
  metrics,
  metricKey,
  height = 280,
}: {
  metrics: Array<Record<string, unknown>>;
  metricKey: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'hsl(220 23% 4%)' },
        textColor: 'hsl(215 10% 55%)',
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(30, 40, 60, 0.5)' },
        horzLines: { color: 'rgba(30, 40, 60, 0.5)' },
      },
      width: el.clientWidth,
      height,
      timeScale: { timeVisible: false },
      crosshair: {
        horzLine: { color: 'hsl(38 92% 52% / 0.4)', width: 1, style: 2 },
        vertLine: { color: 'hsl(38 92% 52% / 0.4)', width: 1, style: 2 },
      },
    });
    const series = chart.addSeries(LineSeries, {
      color: 'hsl(142 70% 45%)',
      lineWidth: 2,
    });

    const seen = new Set<number>();
    const data: Array<{ time: any; value: number }> = [];
    for (const m of metrics) {
      const t = Number((m as any).tick);
      const v = Number((m as any)[metricKey]);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      data.push({ time: t as any, value: v });
    }
    data.sort((a, b) => (a.time as number) - (b.time as number));

    if (data.length > 0) {
      series.setData(data);
      chart.timeScale().fitContent();
    }

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [metrics, metricKey, height]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}

export function LightweightLine(props: { metrics: Array<Record<string, unknown>>; metricKey: string; height?: number }) {
  return (
    <ChartErrorBoundary>
      <LightweightLineInner {...props} />
    </ChartErrorBoundary>
  );
}
