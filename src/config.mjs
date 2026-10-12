const provider = process.env.JEV_PROVIDER || (process.env.OPENROUTER_API_KEY && !process.env.TYPESAFE_API_KEY ? "openrouter" : "typesafe");
if (!["typesafe", "openrouter"].includes(provider)) throw new Error(`Unknown JEV_PROVIDER: ${provider}`);

export const config = {
  jevProvider: provider,
  jevApiUrl: process.env.JEV_API_URL || (provider === "openrouter" ? "https://openrouter.ai/api/v1/systemone" : "https://api.typesafe.ai/v1/systemone"),
  jevModel: process.env.JEV_MODEL || "jev-latest",
  kapturePort: Number(process.env.KAPTURE_PORT || 61822),
  leaseTtlMs: Number(process.env.JEVSTEER_LEASE_TTL_MS || 120000),
  verifyPassAt: Number(process.env.JEVSTEER_VERIFY_PASS_AT || 0.82),
  verifyFailAt: Number(process.env.JEVSTEER_VERIFY_FAIL_AT || 0.35),
  driftStopAt: Number(process.env.JEVSTEER_DRIFT_STOP_AT || 0.25),
  driftAutoRecoverAt: Number(process.env.JEVSTEER_DRIFT_RECOVER_AT || 0.12),
  sideEffectSafeAt: Number(process.env.JEVSTEER_SIDE_EFFECT_SAFE_AT || 0.2),
  constraintRiskAt: Number(process.env.JEVSTEER_CONSTRAINT_RISK_AT || 0.55),
  nextStepClearAt: Number(process.env.JEVSTEER_NEXT_STEP_CLEAR_AT || 0.45),
  maxAutoRecoveries: Number(process.env.JEVSTEER_MAX_AUTO_RECOVERIES || 2),
  modelPageTextChars: Number(process.env.JEVSTEER_PAGE_TEXT_CHARS || 8000),
  maxSingleElements: 240,
  maxStateChars: 70000,
  elementGroupSize: 30,
};

export function requireTypesafeKey() {
  const key = config.jevProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error(`${config.jevProvider === "openrouter" ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY"} is not set. Expose the API key to the MCP process.`);
  return key;
}
