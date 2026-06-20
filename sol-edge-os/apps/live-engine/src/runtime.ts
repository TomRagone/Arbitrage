import type { ExecutionConfig } from "./config";
import { withGuardrails, type GuardrailConfig, type RejectionLogEntry } from "./venue/Guardrails";
import { withShadowMode, type IntendedOrder } from "./venue/ShadowVenue";
import type { ExecutionVenue } from "./venue/Venue";

export interface RuntimeVenueDeps {
  /// Always available, used directly (wrapped only in guardrails) in "paper" mode.
  readonly paperVenue: ExecutionVenue;
  readonly guardrailCaps: GuardrailConfig;
  readonly onRejection?: (entry: RejectionLogEntry) => void;
  readonly onIntendedOrder?: (intended: IntendedOrder) => void;
  /// Stand-in for what LiveVenue's state would be, read ONLY by shadow
  /// mode's guardrail position/exposure checks. 10D.4 (the real
  /// authenticated LiveVenue) is deliberately out of scope — this
  /// defaults to the same paperVenue, which is an approximation, not a
  /// substitute for real live state once 10D.4 exists.
  readonly shadowStateVenue?: ExecutionVenue;
}

/// The one place execution mode changes what gets constructed. paper and
/// shadow are both fully implemented; live throws unconditionally —
/// loadExecutionConfig() already refuses to even reach this function
/// with mode="live" unless liveConfirmed + env vars agree, but even a
/// fully-confirmed config has nowhere to go: LiveVenue (10D.4) does not
/// exist in this codebase. This throw is the hard boundary enforced in
/// architecture, not merely by omission — there is no path through this
/// function that ends in a real network call to an exchange.
export function buildRuntimeVenue(config: ExecutionConfig, deps: RuntimeVenueDeps): ExecutionVenue {
  if (config.mode === "paper") {
    return withGuardrails(deps.paperVenue, deps.guardrailCaps, deps.onRejection);
  }

  if (config.mode === "shadow") {
    const stateVenue = deps.shadowStateVenue ?? deps.paperVenue;
    const shadow = withShadowMode(stateVenue, deps.onIntendedOrder ?? (() => {}));
    return withGuardrails(shadow, deps.guardrailCaps, deps.onRejection);
  }

  throw new Error(
    'buildRuntimeVenue: mode="live" is not implemented. Phase 10D.4 (authenticated LiveVenue) is a deliberate, uncrossed boundary in this codebase — no live venue exists to construct, regardless of how config/execution.json and the environment are set.',
  );
}
