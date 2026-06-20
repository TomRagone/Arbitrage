export type PromotionRung = "live-small-cap";

export interface PaperTrackRecord {
  readonly daysRun: number; // the committed period the strategy has actually run in paper/shadow
  readonly realityGapWithinTolerance: boolean; // realized paper fills tracked the simulator's assumed reality gap within tolerance
}

export interface StrategyRecord {
  readonly id: string;
  readonly passedHoldout: boolean; // the 10C touch-once holdout result
  readonly paperTrackRecord: PaperTrackRecord | null; // null if it never ran in paper/shadow at all
}

export interface PromotionConfig {
  readonly minPaperDays: number;
  readonly startingNotionalCap: number; // hard, small — scaling up is a separate, later, equally explicit action
}

export interface PromotionRecord {
  readonly strategyId: string;
  readonly rung: PromotionRung;
  readonly notionalCap: number;
  readonly ts: number;
}

export class PromotionRefusedError extends Error {}

export interface PromotionLogEntry {
  readonly ts: number;
  readonly strategyId: string;
  readonly outcome: "refused" | "promoted";
  readonly reason: string;
}

/// The live-money analog of the 10C touch-once holdout: an explicit,
/// logged action, never a config default, never automatic. Refusal is
/// the default outcome — a strategy must affirmatively clear every gate,
/// not merely fail to fail one. Every outcome (refused or promoted) is
/// logged via onLog, in addition to either throwing or returning.
export function promoteToLive(strategy: StrategyRecord, config: PromotionConfig, onLog?: (entry: PromotionLogEntry) => void): PromotionRecord {
  function refuse(reason: string): never {
    onLog?.({ ts: Date.now(), strategyId: strategy.id, outcome: "refused", reason });
    throw new PromotionRefusedError(reason);
  }

  if (!strategy.passedHoldout) {
    refuse(`strategy "${strategy.id}" has not passed its 10C holdout — promotion refused`);
  }

  if (!strategy.paperTrackRecord) {
    refuse(`strategy "${strategy.id}" has no paper/shadow track record at all — promotion refused`);
  }

  if (strategy.paperTrackRecord!.daysRun < config.minPaperDays) {
    refuse(
      `strategy "${strategy.id}" ran in paper/shadow for only ${strategy.paperTrackRecord!.daysRun} day(s), below the committed ${config.minPaperDays}-day period — promotion refused`,
    );
  }

  if (!strategy.paperTrackRecord!.realityGapWithinTolerance) {
    refuse(`strategy "${strategy.id}"'s realized paper fills did not track the simulator's reality gap within tolerance — promotion refused`);
  }

  const record: PromotionRecord = {
    strategyId: strategy.id,
    rung: "live-small-cap",
    notionalCap: config.startingNotionalCap,
    ts: Date.now(),
  };
  onLog?.({
    ts: record.ts,
    strategyId: strategy.id,
    outcome: "promoted",
    reason: `promoted to rung "${record.rung}" at starting notional cap ${record.notionalCap}`,
  });
  return record;
}
