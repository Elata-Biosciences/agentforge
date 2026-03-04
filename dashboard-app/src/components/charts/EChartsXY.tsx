import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { terminalChartDefaults, terminalSeriesColors } from './terminal-theme.ts';

export function EChartsXY({
  rows,
  xField,
  yField,
  seriesField,
  seriesType,
  xLabel,
  yLabel,
  showLegend,
}: {
  rows: Array<Record<string, unknown>>;
  xField: string;
  yField: string;
  seriesField?: string;
  seriesType: 'line' | 'scatter';
  xLabel?: string;
  yLabel?: string;
  showLegend?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const buckets = new Map<string, Array<[number, number]>>();
      for (const r of rows) {
        const x = Number((r as any)[xField]);
        const y = Number((r as any)[yField]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const s = seriesField ? String((r as any)[seriesField] ?? '-') : yField;
        const curr = buckets.get(s) ?? [];
        curr.push([x, y]);
        buckets.set(s, curr);
      }
      const series = [...buckets.entries()].map(([name, data], i) => ({
        name,
        type: seriesType,
        data,
        showSymbol: seriesType === 'scatter',
        symbolSize: seriesType === 'scatter' ? 5 : 2,
        lineStyle: { width: 1.5, color: terminalSeriesColors[i % terminalSeriesColors.length] },
        itemStyle: { color: terminalSeriesColors[i % terminalSeriesColors.length] },
      }));
      chart.setOption({
        ...terminalChartDefaults,
        xAxis: { ...terminalChartDefaults.xAxis, name: xLabel ?? xField },
        yAxis: { ...terminalChartDefaults.yAxis, name: yLabel ?? yField },
        series,
        legend:
          showLegend === undefined
            ? series.length > 1
              ? { show: true, type: 'scroll', textStyle: { color: 'hsl(215 10% 55%)', fontSize: 10, fontFamily: '"IBM Plex Mono", monospace' } }
              : { show: false }
            : { show: showLegend, type: 'scroll', textStyle: { color: 'hsl(215 10% 55%)', fontSize: 10, fontFamily: '"IBM Plex Mono", monospace' } },
      });
      chart.resize();
    }
    render();
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [rows, seriesField, seriesType, xField, yField, xLabel, yLabel, showLegend]);

  return <div ref={ref} className="h-[280px] w-full" />;
}
