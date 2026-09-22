function cleanString(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueStrings(values, { maxItems = 8, maxChars = 500 } = {}) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const clean = cleanString(value, maxChars);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

const ASSERTION_TYPES = new Set([
  "text_contains",
  "text_not_contains",
  "title_contains",
  "url_contains",
  "url_matches",
]);

export function normalizeAssertions(assertions = []) {
  const out = [];
  for (const raw of assertions || []) {
    if (!raw || !ASSERTION_TYPES.has(raw.type)) continue;
    const value = cleanString(raw.value, raw.type === "url_matches" ? 220 : 300);
    if (!value) continue;
    out.push({
      type: raw.type,
      value,
      ...(raw.case_sensitive ? { case_sensitive: true } : {}),
      ...(raw.type === "url_matches" && raw.flags ? { flags: cleanString(raw.flags, 8) } : {}),
    });
    if (out.length >= 12) break;
  }
  return out;
}

export function normalizeTaskContract({ goal, successCriteria, constraints, guidance, assertions } = {}) {
  const cleanGoal = cleanString(goal, 1000);
  if (!cleanGoal) throw new Error("Task goal is required");
  return {
    goal: cleanGoal,
    success_criteria: uniqueStrings(successCriteria, { maxItems: 8, maxChars: 500 }),
    constraints: uniqueStrings(constraints, { maxItems: 8, maxChars: 500 }),
    guidance: uniqueStrings(guidance, { maxItems: 8, maxChars: 500 }),
    assertions: normalizeAssertions(assertions),
  };
}

export function contractForModel(contract) {
  return {
    goal: contract.goal,
    ...(contract.success_criteria.length ? { success_criteria: contract.success_criteria } : {}),
    ...(contract.constraints.length ? { constraints: contract.constraints } : {}),
    ...(contract.guidance?.length ? { guidance: contract.guidance } : {}),
  };
}

export function contractForResume(contract) {
  return {
    goal: contract.goal,
    ...(contract.success_criteria.length ? { success_criteria: contract.success_criteria } : {}),
    ...(contract.constraints.length ? { constraints: contract.constraints } : {}),
    ...(contract.guidance?.length ? { guidance: contract.guidance } : {}),
    ...(contract.assertions.length ? { assertions: contract.assertions } : {}),
  };
}

export { cleanString, uniqueStrings };
