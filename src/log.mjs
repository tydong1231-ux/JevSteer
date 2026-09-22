export const LOG_ENABLED = process.env.JEVSTEER_LOG === "1";

export function log(...args) {
  if (LOG_ENABLED) console.error("[jevsteer]", ...args);
}

export function warn(...args) {
  console.error("[jevsteer]", ...args);
}
