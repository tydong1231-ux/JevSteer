import { JevSteerRuntime } from "../../src/runtime.mjs";
import { ActionJournal } from "../../src/action-journal.mjs";

export class OfflineRuntime extends JevSteerRuntime {
  constructor(options = {}) { super({ journal: new ActionJournal({ dir: null }), observation: { maxMs: 0, quietMs: 0 }, ...options }); }
}

export function decision({ tool = "click", target = 0, value, ...scores } = {}) {
  const answers = Object.fromEntries(Object.entries({
    done: 0.01, done_change: 0.01, on_track: 0.99, blocked: 0.01,
    needs_vision: 0.01, error: 0.01, login: 0.01, irreversible: 0.01,
    side_effect: 0.01, next_step_clear: 0.99, constraint_risk: 0.01, ...scores,
  }).map(([key, noul]) => [key, { noul }]));
  answers.tool = { choice: tool, probabilities: { [tool]: 0.99 } };
  if (target != null) answers.target = { choice: String(target), probabilities: { [String(target)]: 0.99 } };
  if (value != null) answers.value = { choice: value };
  return answers;
}

export function verification(questions, score = 0.99) {
  return Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: score }]));
}

export function scriptedDecider(steps, { verifyScore = 0.99, inspect } = {}) {
  let index = 0;
  return async (state, questions) => {
    inspect?.(state, questions);
    let answers;
    if (questions.goal_complete) answers = verification(questions, verifyScore);
    else if (questions.violates) answers = { violates: { noul: 0.01 } };
    else if (questions.action_side_effect) answers = {};
    else if (questions.applies_choice) answers = {};
    else if (questions.option) answers = { option: { choice: Object.keys(questions.option.criteria)[0] } };
    else if (questions.key) answers = { key: { choice: "Escape" } };
    else {
      const step = steps[Math.min(index++, steps.length - 1)];
      answers = typeof step === "function" ? await step(state, questions) : decision(step);
    }
    return { answers, ms: 1, tokens: 10 };
  };
}

export class MemoryKapture {
  constructor(page = {}) {
    this.page = { url: "https://fixture.test/form", title: "Fixture", text: "Start", metrics: {}, elements: [], ...page };
    this.commands = [];
    this.requests = [];
  }
  async ensureServer() { return { mode: "test", port: 0 }; }
  async listTabs() { return [{ tabId: "test", ...this.page, pageVisibility: { visible: true } }]; }
  async elements(_tab, selector) { return { url: this.page.url, elements: this.page.elements.filter((e) => e.selector === selector).map((e) => ({ ...e, tagName: e.tag, visible: true })) }; }
  async command(_tab, command, args) {
    this.commands.push({ command, args });
    if (command === "network_requests") return { cursor: this.requests.length, requests: this.requests.slice(args.since || 0) };
    if (command === "network_body") return this.body || {};
    await this.onCommand?.(command, args);
    return { success: true };
  }
  async close() {}
}

export function memoryRuntime(kapture, decider) {
  const runtime = new JevSteerRuntime({
    kapture, decider,
    journal: new ActionJournal({ dir: null }), observation: { maxMs: 0, quietMs: 0 },
    leases: { withLease: async (_tab, _meta, fn) => fn(), inspect: async () => null },
    snapshotter: async () => structuredClone(kapture.page),
  });
  runtime.settle = async () => 0;
  return runtime;
}
