import test from "node:test";
import assert from "node:assert/strict";

// The log is read from the environment when the runtime loads. Each test
// file runs in a process of its own.
process.env.JEVSTEER_LOG = "1";
const { MemoryKapture, memoryRuntime, decision } = await import("./helpers/runtime.mjs");

// The Mac's guards rows (ccMonet invoice, rerun on 9a83708) showed no row for
// the line fields, though the actions carried theirs: with two lines alike,
// a row says which line the guards judged.
test("a guards log row names the table row of the field judged, and the constraint the guard fears", async () => {
  const price = { i: 0, selector: "#price-2", tag: "input", role: "textbox", label: "Unit Price", column: "Unit Price", row: 2, value: "" };
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const decider = async (state, questions) => {
      if (questions.violates) return { answers: { violates: { noul: 0.2 }, violated: { choice: "0", probabilities: { 0: 0.6, 1: 0.2, none: 0.2 } } }, ms: 1, tokens: 1 };
      if (questions.action_side_effect) return { answers: { action_side_effect: { noul: 0.05 }, action_irreversible: { noul: 0.01 }, action_unrequested: { noul: 0.1 } }, ms: 1, tokens: 1 };
      return { answers: decision({ tool: "type", target: 0 }), ms: 1, tokens: 1 };
    };
    const runtime = memoryRuntime(new MemoryKapture({ elements: [price] }), decider);
    await runtime.run("Enter line 2's price", { values: { price_b: "50" }, constraints: ["Do not change line 1", "Do not save"], maxActions: 1, evidenceLevel: "none" });
  } finally { console.error = original; }
  const row = lines.map((line) => line.match(/^\[jevsteer\] r0 guards (.*)$/)?.[1]).find(Boolean);
  assert.ok(row, lines.join("\n"));
  assert.deepEqual(JSON.parse(row), {
    side_effect_guard: 0.05, irreversible_guard: 0.01, unrequested_guard: 0.1,
    constraint_guard: 0.2, constraint: "Do not change line 1",
    judged_as: "type", element: 'textbox "Unit Price"', row: 2,
  });
});
