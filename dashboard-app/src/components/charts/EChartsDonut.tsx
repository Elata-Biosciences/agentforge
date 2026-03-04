import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { terminalChartDefaults, terminalSeriesColors } from './terminal-theme.ts';

export function EChartsDonut({
  rows,
  labelField,
  valueField,
}: {
  rows: Array<Record<string, unknown>>;
  labelField: string;
  valueField: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const data = rows
        .map((r) => {
          const name = String((r as any)[labelField] ?? '-');
          const value = Number((r as any)[valueField]);
          if (!Number.isFinite(value)) return null;
          return { name, value };
        })
        .filter(Boolean) as Array<{ name: string; value: number }>;
      chart.setOption({
        ...terminalChartDefaults,
        tooltip: { ...terminalChartDefaults.tooltip, trigger: 'item' },
        series: [
          {
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: true,
            label: {
              show: true,
              formatter: '{b}: {c}',
              color: 'hsl(215 10% 55%)',
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10,
            },
            data,
            itemStyle: {
              borderColor: 'hsl(220 23% 4%)',
              borderWidth: 1,
            },
            color: terminalSeriesColors,
          },
        ],
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
  }, [labelField, rows, valueField]);

  return <div ref={ref} className="h-[280px] w-full" />;
}
