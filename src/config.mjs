// Invalid numeric environment values (typos, empty strings) fall back to the
// default instead of silently becoming NaN, which would disable thresholds.
function num(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  jevApiUrl: process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone",
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
};

export function requireTypesafeKey() {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set. Get a TypeSafe API key and expose it to the MCP process.");
  return key;
}
