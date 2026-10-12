import { config, requireTypesafeKey } from "./config.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validateAnswers(answers, questions) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("Jev returned no valid answers object");
  }
  const selectedTarget = `${answers.tool?.choice || ""}_target`;
  for (const [name, question] of Object.entries(questions)) {
    // Speculative operation-specific heads are independent. If the chosen
    // action is CLICK, an unused TYPE head must not invalidate that action.
    if (name.endsWith("_target") && name !== selectedTarget) continue;
    const answer = answers[name];
    if (!answer || typeof answer !== "object") {
      throw new Error(`Jev response missing answer: ${name}`);
    }
    if (question.type === "noul" && !(typeof answer.noul === "number" && answer.noul >= 0 && answer.noul <= 1)) {
      throw new Error(`Jev returned an invalid noul probability: ${name}`);
    }
    if (question.type === "choice" && (
      typeof answer.choice !== "string"
      || !Object.hasOwn(question.criteria || {}, answer.choice)
      || !answer.probabilities
      || typeof answer.probabilities !== "object"
      || !Object.keys(question.criteria || {}).every(key => Number.isFinite(answer.probabilities[key])
        && answer.probabilities[key] >= 0 && answer.probabilities[key] <= 1)
    )) {
      throw new Error(`Jev returned an invalid choice: ${name}`);
    }
  }
}

export async function jev(state, questions, { retries = 2, timeout = 60000 } = {}) {
  const key = requireTypesafeKey();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = performance.now();
    let response;
    try {
      response = await fetch(config.jevApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, model: config.jevModel, questions }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      await sleep(600 * (attempt + 1));
      continue;
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Jev HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
      lastError = error;
      // Invalid credentials, bad questions and other permanent 4xx are not transient.
      if (attempt === retries || (response.status !== 429 && response.status < 500)) throw error;
      await sleep(600 * (attempt + 1));
      continue;
    }

    // A malformed 2xx response must fail closed, not become a successful action.
    validateAnswers(body.answers, questions);
    return {
      answers: body.answers,
      ms: Math.round(performance.now() - started),
      tokens: body.usage?.input_tokens ?? 0,
    };
  }
  throw lastError ?? new Error("Jev request failed");
}
