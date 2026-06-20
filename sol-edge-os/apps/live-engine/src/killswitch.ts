import fs from "fs";
import type { ExecutionVenue } from "./venue/Venue";

export interface KillSwitchConfig {
  /// File-based manual flag: if this path exists, manual kill is tripped.
  readonly manualFlagPath?: string;
  /// Env-var-based manual flag: if set to a truthy value, manual kill is tripped.
  readonly manualFlagEnvVar?: string;
  readonly maxDailyLossAbs: number;
  readonly maxDrawdownPct: number; // fraction, e.g. 0.1 = 10% off the peak
}

export type HaltReason = "manual" | "daily-loss" | "max-drawdown";

/// Checked once per tick, before any order logic. Two trip mechanisms:
/// a manual flag (file or env, checked every tick — flipping it mid-run
/// halts within one tick by construction, since that's exactly when
/// it's next checked) and automatic daily-loss / max-drawdown
/// thresholds computed from equity the caller supplies (this class has
/// no market-data access of its own). Either trip calls cancelAll() on
/// the wrapped venue and flips to a halted state that does NOT clear on
/// its own — only an explicit, logged resetForRestart() call can resume
/// trading, mirroring the promotion ladder's "no skipping" requirement
/// at the safety-trip level instead of the promotion level.
export class KillSwitch {
  private halted = false;
  private haltReason: HaltReason | null = null;
  private peakEquity: number;
  private readonly startOfDayEquity: number;

  constructor(
    private readonly venue: ExecutionVenue,
    private readonly config: KillSwitchConfig,
    initialEquity: number,
  ) {
    this.peakEquity = initialEquity;
    this.startOfDayEquity = initialEquity;
  }

  isHalted(): boolean {
    return this.halted;
  }

  getHaltReason(): HaltReason | null {
    return this.haltReason;
  }

  private manualFlagTripped(): boolean {
    if (this.config.manualFlagEnvVar && process.env[this.config.manualFlagEnvVar]) return true;
    if (this.config.manualFlagPath && fs.existsSync(this.config.manualFlagPath)) return true;
    return false;
  }

  private async halt(reason: HaltReason): Promise<void> {
    this.halted = true;
    this.haltReason = reason;
    await this.venue.cancelAll();
  }

  /// currentEquity = balance + positionQty * referencePrice, computed by
  /// the caller (this class doesn't know how to price a position).
  async checkTick(currentEquity: number): Promise<void> {
    if (this.halted) return; // already tripped — requires resetForRestart(), not auto-cleared by a calmer tick

    if (this.manualFlagTripped()) {
      await this.halt("manual");
      return;
    }

    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    }
    const drawdown = (this.peakEquity - currentEquity) / this.peakEquity;
    if (drawdown > this.config.maxDrawdownPct) {
      await this.halt("max-drawdown");
      return;
    }

    const dailyLoss = this.startOfDayEquity - currentEquity;
    if (dailyLoss > this.config.maxDailyLossAbs) {
      await this.halt("daily-loss");
      return;
    }
  }

  /// Explicit, logged manual action required after any halt. Clears the
  /// halted flag and reason only — peak equity and start-of-day equity
  /// are real history and a restart should not erase them.
  resetForRestart(): void {
    this.halted = false;
    this.haltReason = null;
  }
}
