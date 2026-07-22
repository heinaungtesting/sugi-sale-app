type MetricState = {
  counters: Map<string, number>;
  timings: Map<string, number[]>;
  gauges: Map<string, number>;
};

declare global {
  // eslint-disable-next-line no-var
  var sugiMetrics: MetricState | undefined;
}

const state: MetricState = globalThis.sugiMetrics ?? {
  counters: new Map(),
  timings: new Map(),
  gauges: new Map(),
};
globalThis.sugiMetrics = state;

export function incrementMetric(name: string, amount = 1): void {
  state.counters.set(name, (state.counters.get(name) ?? 0) + amount);
}

export function setGauge(name: string, value: number): void {
  state.gauges.set(name, Number.isFinite(value) ? value : 0);
}

export function observeMetric(name: string, durationMs: number): void {
  const values = state.timings.get(name) ?? [];
  values.push(Math.max(0, durationMs));
  if (values.length > 1000) values.splice(0, values.length - 1000);
  state.timings.set(name, values);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

export function metricsSnapshot() {
  const timings: Record<string, { count: number; p50: number | null; p95: number | null }> = {};
  for (const [name, values] of state.timings) {
    const sorted = [...values].sort((a, b) => a - b);
    timings[name] = { count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  }
  return {
    generatedAt: new Date().toISOString(),
    processId: process.pid,
    counters: Object.fromEntries(state.counters),
    gauges: Object.fromEntries(state.gauges),
    timings,
  };
}
