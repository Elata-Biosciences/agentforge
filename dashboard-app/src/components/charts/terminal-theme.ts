const gridColor = 'rgba(30, 40, 60, 0.5)';
const axisLabelColor = 'hsl(215 10% 55%)';
const tooltipBg = 'hsl(220 20% 7%)';
const tooltipBorder = 'hsl(220 10% 20%)';

export const terminalChartDefaults = {
  animation: false,
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 11,
    color: axisLabelColor,
  },
  grid: { left: 48, right: 12, top: 16, bottom: 32, containLabel: false },
  xAxis: {
    type: 'value' as const,
    axisLine: { lineStyle: { color: gridColor } },
    splitLine: { lineStyle: { color: gridColor } },
    axisLabel: { color: axisLabelColor, fontSize: 10 },
  },
  yAxis: {
    type: 'value' as const,
    scale: true,
    axisLine: { lineStyle: { color: gridColor } },
    splitLine: { lineStyle: { color: gridColor } },
    axisLabel: { color: axisLabelColor, fontSize: 10 },
  },
  tooltip: {
    trigger: 'axis' as const,
    backgroundColor: tooltipBg,
    borderColor: tooltipBorder,
    borderWidth: 1,
    textStyle: {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 11,
      color: 'hsl(210 14% 92%)',
    },
  },
  dataZoom: [
    { type: 'inside' as const, start: 0, end: 100 },
  ],
} as const;

export const terminalSeriesColors = [
  'hsl(142 70% 45%)',   // green
  'hsl(38 92% 52%)',    // amber
  'hsl(210 80% 60%)',   // blue
  'hsl(0 72% 52%)',     // red
  'hsl(280 60% 60%)',   // purple
  'hsl(180 60% 50%)',   // cyan
  'hsl(45 90% 60%)',    // gold
  'hsl(330 60% 55%)',   // pink
];
