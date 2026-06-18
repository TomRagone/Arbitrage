/**
 * Thin wrapper applying the locked 15m timeframe to the generalized
 * @sol-edge/analytics loader, so existing scripts' no-arg call sites keep
 * working unchanged. The timeframe sweep calls the generic
 * loadHistoricalSignals(intervalMinutes) directly instead of this wrapper.
 */
import { loadHistoricalSignals as loadHistoricalSignalsGeneric, computeBiasSeries as computeBiasSeriesGeneric, utcDay } from "@sol-edge/analytics";
import type { Candle } from "@sol-edge/exchanges";
import { LOWER_TF_INTERVAL_MINUTES } from "../src/engine";

export { utcDay };
export type { HistoricalSignals, TimedSignal } from "@sol-edge/analytics";

export async function loadHistoricalSignals() {
  return loadHistoricalSignalsGeneric(LOWER_TF_INTERVAL_MINUTES);
}

export function computeBiasSeries(completed1h: Candle[], completedLowerTf: Candle[]) {
  return computeBiasSeriesGeneric(completed1h, completedLowerTf, LOWER_TF_INTERVAL_MINUTES);
}
