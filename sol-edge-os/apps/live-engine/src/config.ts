import executionConfigJson from "../../../config/execution.json";

/**
 * Mode + secrets contract (Phase 10D.0). This is the one gate every live
 * runtime entrypoint must pass through before constructing any venue or
 * making any network call. paper is the only mode reachable by default —
 * live requires two independent, explicit signals to agree
 * (config.live.liveConfirmed AND every required env var present); either
 * one alone is refused. There is deliberately no way to flip mode to
 * "live" by a stale config or a missing env file alone.
 */
export type ExecutionMode = "paper" | "shadow" | "live";

export interface ExecutionConfig {
  readonly mode: ExecutionMode;
  readonly live: {
    readonly liveConfirmed: boolean;
    readonly requiredEnvVars: readonly string[];
  };
}

export class LiveModeRefusedError extends Error {}

const VALID_MODES: readonly ExecutionMode[] = ["paper", "shadow", "live"];

/// Throws synchronously — before any venue is constructed, before any
/// network call — if the config is malformed or if mode="live" without
/// BOTH liveConfirmed=true and every required env var present. Safe to
/// call as the very first line of any live-engine entrypoint.
/// `configOverride` exists only so tests can exercise every mode/env
/// combination without mutating the committed config/execution.json —
/// production callers always rely on the default (the real file).
export function loadExecutionConfig(env: NodeJS.ProcessEnv = process.env, configOverride?: ExecutionConfig): ExecutionConfig {
  const config = configOverride ?? (executionConfigJson as ExecutionConfig);

  if (!VALID_MODES.includes(config.mode)) {
    throw new LiveModeRefusedError(`config/execution.json: invalid mode "${config.mode}" — must be one of ${VALID_MODES.join("|")}`);
  }

  if (config.mode !== "live") {
    return config; // paper and shadow never touch the live-only checks below
  }

  if (!config.live.liveConfirmed) {
    throw new LiveModeRefusedError(
      `Refusing to start in live mode: config/execution.json has live.liveConfirmed=false. ` +
        `Live mode requires an explicit, logged, per-run opt-in — flip liveConfirmed to true only when you mean it.`,
    );
  }

  const missing = config.live.requiredEnvVars.filter((name) => !env[name] || env[name]!.length === 0);
  if (missing.length > 0) {
    throw new LiveModeRefusedError(
      `Refusing to start in live mode: missing required environment variable(s): ${missing.join(", ")}. ` +
        `liveConfirmed=true alone is not sufficient — see .env.example.`,
    );
  }

  return config;
}
