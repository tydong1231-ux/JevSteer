import test from "node:test";
import assert from "node:assert/strict";
import { JevSteerRuntime } from "../src/runtime.mjs";

class FakeLeases {
  async withLease(_tabId, _meta, fn) { return fn(); }
  async inspect() { return null; }
}

class FakeKapture {
  constructor({ buttonFirst = false } = {}) {
    this.state = 0;
    this.log = [];
    this.buttonFirst = buttonFirst;
  }
  async ensureServer() { return { mode: "fake", port: 61822 }; }
  async listTabs() { return [{ tabId: "t1", title: "Start", url: this.url(), connectedAt: 1, pageVisibility: { visible: true } }]; }
  url() { return ["https://app.test/start", "https://app.test/wrong", "https://app.test/final"][this.state]; }
  async tabDetail() {
    return { tabId: "t1", title: ["Start", "Wrong", "Final"][this.state], url: this.url(), domSize: this.dom().then ? 100 : 100, pageVisibility: { visible: true } };
  }
  async dom() {
    if (this.state === 0) return { html: this.buttonFirst ? '<body><button id="wrong">Wrong</button><a id="correct" href="/final">Correct</a></body>' : '<body><a id="wrong" href="/wrong">Wrong</a><a id="correct" href="/final">Correct</a></body>' };
    if (this.state === 1) return { html: '<body><h1>Wrong customer</h1></body>' };
    return { html: '<body><h1>ABC Pte Ltd</h1><div>Latest invoice INV-42</div></body>' };
  }
  async elements() {
    if (this.state !== 0) return { elements: [] };
    return { elements: [
      { visible: true, selector: "#wrong", tagName: "a", href: "/wrong", bounds: {} },
      { visible: true, selector: "#correct", tagName: "a", href: "/final", bounds: {} },
    ] };
  }
  async command(_tabId, command, args = {}) {
    this.log.push({ command, args });
    if (command === "click") {
      if (args.selector === "#wrong") this.state = 1;
      if (args.selector === "#correct") this.state = 2;
      return { clicked: true };
    }
    if (command === "back") { this.state = 0; return { success: true }; }
    return { success: true };
  }
  snapshot() {
    if (this.state === 0) return {
      url: this.url(), title: "Start", text: "Wrong Correct", metrics: { elements: 2 },
      elements: [
        { i: 0, selector: "#wrong", tag: this.buttonFirst ? "button" : "a", role: this.buttonFirst ? "button" : "link", label: "Wrong", text: "Wrong", ...(this.buttonFirst ? {} : { href: "/wrong" }) },
        { i: 1, selector: "#correct", tag: "a", role: "link", label: "Correct", text: "Correct", href: "/final" },
      ],
    };
    if (this.state === 1) return { url: this.url(), title: "Wrong", text: "Wrong customer", metrics: { elements: 0 }, elements: [] };
    return { url: this.url(), title: "Final", text: "ABC Pte Ltd Latest invoice INV-42", metrics: { elements: 0 }, elements: [] };
  }
  async close() {}
}

function answerSet({ tool = "click", target = 0, done = 0.05, onTrack = 0.95, sideEffect = 0.05 } = {}) {
  return {
    done: { noul: done }, done_change: { noul: done }, on_track: { noul: onTrack },
    blocked: { noul: 0.01 }, needs_vision: { noul: 0.01 }, error: { noul: 0.01 }, login: { noul: 0.01 },
    irreversible: { noul: 0.02 }, side_effect: { noul: sideEffect },
    tool: { choice: tool, probabilities: { [tool]: 0.98 } },
    ...(tool !== "none" ? { target: { choice: String(target), probabilities: { [String(target)]: 0.98 } } } : {}),
  };
}

function makeDecider({ highSideEffect = false } = {}) {
  return async (state, questions) => {
    if (questions.goal_complete) {
      const answers = { goal_complete: { noul: 0.99 } };
      for (const key of Object.keys(questions)) if (key.startsWith("criterion_")) answers[key] = { noul: 0.99 };
      if (questions.constraints_ok) answers.constraints_ok = { noul: 0.99 };
      return { answers, ms: 1, tokens: 10 };
    }
    const url = state.page.url;
    let base;
    if (url.endsWith("/wrong")) base = answerSet({ tool: "none", done: 0.02, onTrack: 0.03, sideEffect: 0.01 });
    else if (url.endsWith("/final")) base = answerSet({ tool: "none", done: 0.98, onTrack: 0.99, sideEffect: 0.01 });
    else {
      const recovered = state.task.history?.some((x) => x.recovery === "back");
      base = answerSet({ target: recovered ? 1 : 0, sideEffect: highSideEffect ? 0.9 : 0.03 });
    }
    if (questions.constraint_risk) base.constraint_risk = { noul: 0.01 };
    return { answers: base, ms: 1, tokens: 10 };
  };
}

test("runtime auto-recovers only a clearly safe navigation drift", async () => {
  const kapture = new FakeKapture();
  const runtime = new JevSteerRuntime({ kapture, leases: new FakeLeases(), decider: makeDecider(), snapshotter: async (k) => k.snapshot() });
  runtime.settle = async () => 0;
  const result = await runtime.run("Open the correct customer", {
    successCriteria: ["ABC Pte Ltd page is open"],
    maxActions: 8,
  });
  assert.equal(result.status, "completed_verified");
  assert.equal(result.auto_recoveries, 1);
  assert.equal(kapture.log.some((x) => x.command === "back"), true);
  assert.equal(kapture.log.some((x) => x.command === "click" && x.args.selector === "#correct"), true);
});

test("runtime never auto-backs after a likely remote side effect", async () => {
  const kapture = new FakeKapture();
  const runtime = new JevSteerRuntime({ kapture, leases: new FakeLeases(), decider: makeDecider({ highSideEffect: true }), snapshotter: async (k) => k.snapshot() });
  runtime.settle = async () => 0;
  const result = await runtime.run("Open the correct customer", { maxActions: 5 });
  assert.equal(result.status, "drifted");
  assert.equal(result.auto_recoveries, 0);
  assert.equal(kapture.log.some((x) => x.command === "back"), false);
  assert.equal(result.recovery.strategy, "inspect_and_replan");
});


test("runtime does not auto-back a button click even when side-effect confidence is low", async () => {
  const kapture = new FakeKapture({ buttonFirst: true });
  const runtime = new JevSteerRuntime({ kapture, leases: new FakeLeases(), decider: makeDecider(), snapshotter: async (k) => k.snapshot() });
  runtime.settle = async () => 0;
  const result = await runtime.run("Open the correct customer", { maxActions: 5 });
  assert.equal(result.status, "drifted");
  assert.equal(result.auto_recoveries, 0);
  assert.equal(kapture.log.some((x) => x.command === "back"), false);
});

test("runtime refuses to guess when multiple tabs are plausible", async () => {
  const kapture = new FakeKapture();
  kapture.listTabs = async () => [
    { tabId: "a", title: "A", url: "https://a.test", pageVisibility: { visible: true } },
    { tabId: "b", title: "B", url: "https://b.test", pageVisibility: { visible: true } },
  ];
  const runtime = new JevSteerRuntime({ kapture, leases: new FakeLeases(), decider: makeDecider(), snapshotter: async (k) => k.snapshot() });
  const result = await runtime.run("Open the invoice");
  assert.equal(result.status, "needs_tab_selection");
  assert.equal(result.recovery.next_tool, "browser_tabs");
  assert.equal(result.tabs.length, 2);
});


test("runtime stops instead of auto-backing when drift is suspicious but not extreme", async () => {
  const kapture = new FakeKapture();
  const decider = async (state, questions) => {
    if (questions.goal_complete) return { answers: { goal_complete: { noul: 0.1 } }, ms: 1, tokens: 10 };
    const wrong = state.page.url.endsWith("/wrong");
    return { answers: wrong ? answerSet({ tool: "none", done: 0.02, onTrack: 0.2, sideEffect: 0.01 }) : answerSet({ target: 0, sideEffect: 0.01 }), ms: 1, tokens: 10 };
  };
  const runtime = new JevSteerRuntime({ kapture, leases: new FakeLeases(), decider, snapshotter: async (k) => k.snapshot() });
  runtime.settle = async () => 0;
  const result = await runtime.run("Open the correct customer", { maxActions: 4 });
  assert.equal(result.status, "drifted");
  assert.equal(result.auto_recoveries, 0);
  assert.equal(kapture.log.some((x) => x.command === "back"), false);
});

test("runtime re-checks the exact selected action when constraints and side effects are sensitive", async () => {
  const kapture = new FakeKapture({ buttonFirst: true });
  const decider = async (_state, questions) => {
    if (questions.violates) return { answers: { violates: { noul: 0.96 } }, ms: 1, tokens: 5 };
    const answers = answerSet({ target: 0, sideEffect: 0.8 });
    if (questions.constraint_risk) answers.constraint_risk = { noul: 0.1 };
    return { answers, ms: 1, tokens: 10 };
  };
  const runtime = new JevSteerRuntime({ kapture, leases: new FakeLeases(), decider, snapshotter: async (k) => k.snapshot() });
  runtime.settle = async () => 0;
  const result = await runtime.run("Open the customer", {
    constraints: ["Do not change remote data"],
    maxActions: 3,
  });
  assert.equal(result.status, "constraint_blocked");
  assert.equal(kapture.log.some((x) => x.command === "click"), false);
  assert.equal(result.pending.p_constraint_risk, 0.96);
});

test("rough constraint risk is only a prefilter; the exact action guard can clear a safe action", async () => {
  const kapture = new FakeKapture();
  const decider = async (state, questions) => {
    if (questions.violates) return { answers: { violates: { noul: 0.05 } }, ms: 1, tokens: 5 };
    if (questions.goal_complete) {
      const answers = { goal_complete: { noul: 0.99 } };
      if (questions.constraints_ok) answers.constraints_ok = { noul: 0.99 };
      return { answers, ms: 1, tokens: 5 };
    }
    if (state.page.url.endsWith("/final")) {
      const answers = answerSet({ tool: "none", done: 0.98, onTrack: 0.99, sideEffect: 0.01 });
      answers.constraint_risk = { noul: 0.01 };
      return { answers, ms: 1, tokens: 10 };
    }
    const answers = answerSet({ target: 1, sideEffect: 0.05 });
    answers.constraint_risk = { noul: 0.9 };
    return { answers, ms: 1, tokens: 10 };
  };
  const runtime = new JevSteerRuntime({ kapture, leases: new FakeLeases(), decider, snapshotter: async (k) => k.snapshot() });
  runtime.settle = async () => 0;
  const result = await runtime.run("Open the correct customer", {
    constraints: ["Do not modify remote data"],
    maxActions: 4,
  });
  assert.equal(result.status, "completed_verified");
  assert.equal(kapture.log.some((x) => x.command === "click" && x.args.selector === "#correct"), true);
});