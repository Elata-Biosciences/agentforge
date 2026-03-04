import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { terminalChartDefaults, terminalSeriesColors } from './terminal-theme.ts';

export function EChartsHistogram({
  rows,
  valueField,
  bins,
  xLabel,
}: {
  rows: Array<Record<string, unknown>>;
  valueField: string;
  bins?: number;
  xLabel?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const values: number[] = [];
      for (const r of rows) {
        const v = Number((r as any)[valueField]);
        if (Number.isFinite(v)) values.push(v);
      }
      if (values.length === 0) {
        chart.clear();
        return;
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const nBins = Math.max(2, Math.min(200, Math.floor(bins ?? 20)));
      const width = max === min ? 1 : (max - min) / nBins;
      const counts = new Array<number>(nBins).fill(0);
      for (const v of values) {
        const idx = Math.max(0, Math.min(nBins - 1, Math.floor((v - min) / width)));
        counts[idx] = (counts[idx] ?? 0) + 1;
      }
      const labels = counts.map((_c, i) => {
        const lo = min + i * width;
        const hi = lo + width;
        return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
      });
      chart.setOption({
        ...terminalChartDefaults,
        grid: { ...terminalChartDefaults.grid, bottom: 56 },
        xAxis: {
          type: 'category',
          name: xLabel ?? valueField,
          data: labels,
          axisLabel: { ...terminalChartDefaults.xAxis.axisLabel, rotate: 35 },
          axisLine: terminalChartDefaults.xAxis.axisLine,
        },
        yAxis: { ...terminalChartDefaults.yAxis, name: 'count' },
        series: [{
          type: 'bar',
          data: counts,
          itemStyle: { color: terminalSeriesColors[2] },
        }],
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
  }, [rows, valueField, bins, xLabel]);

  return <div ref={ref} className="h-[280px] w-full" />;
}
