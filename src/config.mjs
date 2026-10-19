// Invalid numeric environment values (typos, empty strings) fall back to the
// default instead of silently becoming NaN, which would disable thresholds.
function num(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const provider = process.env.JEV_PROVIDER || (process.env.OPENROUTER_API_KEY && !process.env.TYPESAFE_API_KEY ? "openrouter" : "typesafe");
if (!["typesafe", "openrouter"].includes(provider)) throw new Error(`Unknown JEV_PROVIDER: ${provider}`);

export const config = {
  browserDriver: process.env.JEVSTEER_BROWSER_DRIVER || "kapture",
  browserHeadless: process.env.JEVSTEER_HEADLESS === "1",
  browserProfile: process.env.JEVSTEER_BROWSER_PROFILE || ".jevsteer-state/profiles/default",
  browserCdpEndpoint: process.env.JEVSTEER_CDP_ENDPOINT || undefined,
  browserChannel: process.env.JEVSTEER_BROWSER_CHANNEL || undefined,
  browserInputMode: process.env.JEVSTEER_INPUT_MODE || "fast",
  browserTimeoutMs: num("JEVSTEER_BROWSER_TIMEOUT_MS", 15000),
  jevProvider: provider,
  jevApiUrl: process.env.JEV_API_URL || (provider === "openrouter" ? "https://openrouter.ai/api/v1/systemone" : "https://api.typesafe.ai/v1/systemone"),
  jevModel: process.env.JEV_MODEL || "jev-latest",
  kapturePort: num("KAPTURE_PORT", 61822),
  leaseTtlMs: num("JEVSTEER_LEASE_TTL_MS", 120000),
  verifyPassAt: num("JEVSTEER_VERIFY_PASS_AT", 0.82),
  verifyFailAt: num("JEVSTEER_VERIFY_FAIL_AT", 0.35),
  driftStopAt: num("JEVSTEER_DRIFT_STOP_AT", 0.25),
  driftAutoRecoverAt: num("JEVSTEER_DRIFT_RECOVER_AT", 0.12),
  sideEffectSafeAt: num("JEVSTEER_SIDE_EFFECT_SAFE_AT", 0.2),
  constraintRiskAt: num("JEVSTEER_CONSTRAINT_RISK_AT", 0.55),
  nextStepClearAt: num("JEVSTEER_NEXT_STEP_CLEAR_AT", 0.45),
  maxAutoRecoveries: num("JEVSTEER_MAX_AUTO_RECOVERIES", 2),
  modelPageTextChars: num("JEVSTEER_PAGE_TEXT_CHARS", 8000),
  maxSingleElements: 240,
  maxStateChars: 70000,
  elementGroupSize: 30,
  actionSettleMs: num("JEVSTEER_ACTION_SETTLE_MS", 8000),
  navigationSettleMs: num("JEVSTEER_NAVIGATION_SETTLE_MS", 15000),
  observationQuietMs: num("JEVSTEER_OBSERVATION_QUIET_MS", 250),
  maxWaits: num("JEVSTEER_MAX_WAITS", 12),
  maxIdleWaits: num("JEVSTEER_MAX_IDLE_WAITS", 3),
};

export function requireTypesafeKey() {
  const key = config.jevProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error(`${config.jevProvider === "openrouter" ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY"} is not set. Expose the API key to the MCP process.`);
  return key;
}
