import { config, requireTypesafeKey } from "./config.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function jev(state, questions, { retries = 2, timeout = 60000 } = {}) {
  const key = requireTypesafeKey();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = performance.now();
    try {
      const response = await fetch(config.jevApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, model: config.jevModel, questions }),
        signal: AbortSignal.timeout(timeout),
      });

      const body = await response.json().catch(() => ({}));
      const ms = Math.round(performance.now() - started);

      if (response.ok) {
        return {
          answers: body.answers,
          ms,
          tokens: body.usage?.input_tokens ?? 0,
        };
      }

      const error = new Error(`Jev HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
      if (attempt < retries && (response.status === 429 || response.status >= 500)) {
        lastError = error;
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError ?? new Error("Jev request failed");
}
