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
  "field_equals", "control_checked", "element_count",
]);

export function normalizeAssertions(assertions = []) {
  const out = [];
  for (const raw of assertions || []) {
    if (!raw || !ASSERTION_TYPES.has(raw.type)) throw new Error(`Unsupported assertion type: ${raw?.type}`);
    const control = ["field_equals", "control_checked", "element_count"].includes(raw.type);
    if (control && !cleanString(raw.label, 180)) throw new Error("Control assertion requires a label");
    if (raw.type === "control_checked" && typeof raw.value !== "boolean") throw new Error("control_checked requires a boolean value");
    if (raw.type === "element_count" && (!Number.isInteger(raw.value) || raw.value < 0)) throw new Error("element_count requires a nonnegative integer");
    if (raw.type === "field_equals" && typeof raw.value !== "string") throw new Error("field_equals requires a string value");
    // Regexes are kept verbatim: collapsing whitespace or truncating would
    // silently change (or break) the pattern. Other values are plain text.
    if (raw.type === "url_matches" && String(raw.value ?? "").trim().length > 300) throw new Error("url_matches pattern is too long (max 300 characters)");
    const value = control ? raw.value
      : raw.type === "url_matches" ? String(raw.value ?? "").trim()
        : cleanString(raw.value, 300);
    if (!control && !value) throw new Error("Assertion requires a nonempty value");
    out.push({
      type: raw.type,
      value,
      ...(control ? { label: cleanString(raw.label, 180), ...(raw.context ? { context: cleanString(raw.context, 300) } : {}) } : {}),
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
