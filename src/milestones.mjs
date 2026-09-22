import { normalizeTaskContract, cleanString, uniqueStrings } from "./task-contract.mjs";

function milestoneId(value, index) {
  const clean = cleanString(value, 80).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || `milestone-${index + 1}`;
}

export function normalizeMilestonePlan({
  goal,
  milestones = [],
  successCriteria = [],
  constraints = [],
  guidance = [],
  assertions = [],
  maxActions = 12,
} = {}) {
  const overallGoal = cleanString(goal, 1000);
  if (!overallGoal) throw new Error("Task goal is required");

  if (!milestones?.length) {
    return {
      goal: overallGoal,
      milestones: [{
        id: "main",
        ...normalizeTaskContract({ goal: overallGoal, successCriteria, constraints, guidance, assertions }),
        max_actions: maxActions,
      }],
    };
  }

  const ids = new Set();
  const normalized = milestones.slice(0, 12).map((raw, index) => {
    const id = milestoneId(raw?.id, index);
    if (ids.has(id)) throw new Error(`Duplicate milestone id: ${id}`);
    ids.add(id);
    const inheritedConstraints = uniqueStrings([...(constraints || []), ...(raw?.constraints || [])]);
    const inheritedGuidance = uniqueStrings([...(guidance || []), ...(raw?.guidance || [])]);
    const contract = normalizeTaskContract({
      goal: raw?.goal,
      successCriteria: raw?.success_criteria || raw?.successCriteria || [],
      constraints: inheritedConstraints,
      guidance: inheritedGuidance,
      assertions: raw?.assertions || [],
    });
    return {
      id,
      ...contract,
      max_actions: Math.max(1, Math.min(40, Number(raw?.max_actions || raw?.maxActions || maxActions || 12))),
    };
  });

  return { goal: overallGoal, milestones: normalized };
}

export function milestoneForHost(milestone) {
  return {
    id: milestone.id,
    goal: milestone.goal,
    success_criteria: milestone.success_criteria,
    ...(milestone.constraints.length ? { constraints: milestone.constraints } : {}),
    ...(milestone.guidance.length ? { guidance: milestone.guidance } : {}),
    ...(milestone.assertions.length ? { assertions: milestone.assertions } : {}),
  };
}
