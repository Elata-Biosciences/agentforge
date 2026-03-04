import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { terminalChartDefaults, terminalSeriesColors } from './terminal-theme.ts';

export function EChartsBar({
  rows,
  xField,
  yField,
  xLabel,
  yLabel,
}: {
  rows: Array<Record<string, unknown>>;
  xField: string;
  yField: string;
  xLabel?: string;
  yLabel?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const xs: string[] = [];
      const ys: number[] = [];
      for (const r of rows) {
        const x = String((r as any)[xField] ?? '');
        const y = Number((r as any)[yField]);
        if (!x) continue;
        if (!Number.isFinite(y)) continue;
        xs.push(x);
        ys.push(y);
      }
      chart.setOption({
        ...terminalChartDefaults,
        grid: { ...terminalChartDefaults.grid, bottom: 56 },
        xAxis: {
          type: 'category',
          name: xLabel ?? xField,
          data: xs,
          axisLabel: { ...terminalChartDefaults.xAxis.axisLabel, rotate: 35 },
          axisLine: terminalChartDefaults.xAxis.axisLine,
        },
        yAxis: { ...terminalChartDefaults.yAxis, name: yLabel ?? yField },
        series: [{
          type: 'bar',
          data: ys,
          itemStyle: { color: terminalSeriesColors[1] },
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
  }, [rows, xField, yField, xLabel, yLabel]);

  return <div ref={ref} className="h-[280px] w-full" />;
}
