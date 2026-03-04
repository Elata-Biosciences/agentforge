import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { terminalChartDefaults, terminalSeriesColors } from './terminal-theme.ts';

export function EChartsLine({
  metrics,
  metricKey,
}: {
  metrics: Array<Record<string, unknown>>;
  metricKey: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const points: Array<[number, number]> = [];
      for (const m of metrics) {
        const x = Number((m as any).tick);
        const y = Number((m as any)[metricKey]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push([x, y]);
      }
      chart.setOption({
        ...terminalChartDefaults,
        xAxis: { ...terminalChartDefaults.xAxis, name: 'tick' },
        yAxis: { ...terminalChartDefaults.yAxis, name: metricKey },
        series: [{
          type: 'line',
          data: points,
          showSymbol: false,
          lineStyle: { color: terminalSeriesColors[0], width: 1.5 },
          itemStyle: { color: terminalSeriesColors[0] },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'hsl(142 70% 45% / 0.12)' },
              { offset: 1, color: 'hsl(142 70% 45% / 0.01)' },
            ]),
          },
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
  }, [metrics, metricKey]);

  return <div ref={ref} className="h-[280px] w-full" />;
}
