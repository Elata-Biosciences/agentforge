import type {
  ActionDivergence,
  ActionResult,
  ReplayDivergenceResult,
  TickDivergence,
} from '../core/types.js';

export class DivergenceTracker {
  private tickMap = new Map<
    number,
    {
      actionDivergences: ActionDivergence[];
      baselineMetrics: Record<string, number> | undefined;
      replayMetrics: Record<string, number> | undefined;
    }
  >();

  recordAction(
    tick: number,
    agentId: string,
    actionName: string,
    baselineResult: ActionResult | undefined,
    replayResult: ActionResult,
    baselineMetrics?: Record<string, number>
  ): void {
    let entry = this.tickMap.get(tick);
    if (!entry) {
      entry = { actionDivergences: [], baselineMetrics: undefined, replayMetrics: undefined };
      this.tickMap.set(tick, entry);
    }
    if (baselineMetrics && !entry.baselineMetrics) {
      entry.baselineMetrics = baselineMetrics;
    }

    const baselineOk = baselineResult?.ok ?? true;
    const replayOk = replayResult.ok;
    const score = baselineOk === replayOk ? 0 : 1;

    entry.actionDivergences.push({ agentId, actionName, baselineOk, replayOk, score });
  }

  setReplayMetrics(tick: number, metrics: Record<string, number>): void {
    let entry = this.tickMap.get(tick);
    if (!entry) {
      entry = { actionDivergences: [], baselineMetrics: undefined, replayMetrics: undefined };
      this.tickMap.set(tick, entry);
    }
    entry.replayMetrics = metrics;
  }

  build(): ReplayDivergenceResult {
    const tickDivergences: TickDivergence[] = [];
    let totalScore = 0;
    let totalActions = 0;

    const sortedTicks = [...this.tickMap.keys()].sort((a, b) => a - b);
    for (const tick of sortedTicks) {
      const entry = this.tickMap.get(tick)!;
      const metricsDelta: Record<string, { baseline: number; replay: number; pctChange: number }> =
        {};

      if (entry.baselineMetrics && entry.replayMetrics) {
        const allKeys = new Set([
          ...Object.keys(entry.baselineMetrics),
          ...Object.keys(entry.replayMetrics),
        ]);
        for (const key of allKeys) {
          const baseline = entry.baselineMetrics[key] ?? 0;
          const replay = entry.replayMetrics[key] ?? 0;
          if (baseline !== replay) {
            const pctChange =
              baseline !== 0
                ? ((replay - baseline) / Math.abs(baseline)) * 100
                : replay !== 0
                  ? 100
                  : 0;
            metricsDelta[key] = { baseline, replay, pctChange };
          }
        }
      }

      for (const ad of entry.actionDivergences) {
        totalScore += ad.score;
        totalActions += 1;
      }

      if (
        entry.actionDivergences.some((ad) => ad.score > 0) ||
        Object.keys(metricsDelta).length > 0
      ) {
        tickDivergences.push({ tick, actionDivergences: entry.actionDivergences, metricsDelta });
      }
    }

    const overallScore = totalActions > 0 ? totalScore / totalActions : 0;
    return { overallScore, tickDivergences };
  }

  get hasDivergence(): boolean {
    for (const entry of this.tickMap.values()) {
      if (entry.actionDivergences.some((ad) => ad.score > 0)) return true;
    }
    return false;
  }
}
