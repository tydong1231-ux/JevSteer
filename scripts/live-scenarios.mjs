// Explicit opt-in: this script makes paid Jev calls and controls only its own tab.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { JevSteerRuntime } from "../src/runtime.mjs";
import { TabLeaseManager } from "../src/lease.mjs";
import { startFixtureServer } from "../test/helpers/fixture-server.mjs";

const fixture = await startFixtureServer();
const runtime = new JevSteerRuntime({ leases: new TabLeaseManager({ dir: join(process.cwd(), ".test-artifacts", "leases") }) });
const output = process.env.JEVSTEER_TEST_OUTPUT || ".test-artifacts/live-results.json";
const results = [];
let tabId = process.env.JEVSTEER_TEST_TAB;
const scenarios = [
  { id: "hotel-search", path: "/hotels", goal: "Find hotels in Lisbon with category Design and Free cancellation enabled, then open Casa Flora. Stop on the property details page.",
    options: { values: { city: "Lisbon", category: "Design" }, successCriteria: ["Casa Flora property details is open", "Lisbon, Design and free cancellation are all applied"], assertions: [{ type: "url_contains", value: "/hotels/casa-flora" }, { type: "text_contains", value: "City: Lisbon; Category: design; Free cancellation: true" }], constraints: ["Do not book or pay"] },
    check: (page) => { assert(page.url.includes("/hotels/casa-flora")); assert(page.text.includes("City: Lisbon; Category: design; Free cancellation: true")); assert.deepEqual(fixture.state.searches.at(-1), { city: "Lisbon", category: "design", free: true }); } },
  { id: "article-search", path: "/wiki", goal: "Search the encyclopedia and open Gödel's incompleteness theorems.",
    options: { values: { query: "Gödel's incompleteness theorems" }, assertions: [{ type: "url_contains", value: "/wiki/godel" }, { type: "title_contains", value: "incompleteness" }] },
    check: (page) => { assert(page.url.endsWith("/wiki/godel")); assert(page.title.includes("incompleteness")); } },
  { id: "invoice-identity", path: "/invoices", goal: "Find and inspect invoice INV-42 for ABC Pte Ltd. Return its status; do not edit anything.",
    options: { values: { invoice: "INV-42" }, constraints: ["Read only; do not edit, approve, post or delete"], successCriteria: ["Correct customer ABC Pte Ltd and invoice INV-42 are visible", "Invoice status Draft is visible"], assertions: [{ type: "url_contains", value: "/invoices/42" }, { type: "text_contains", value: "Customer: ABC Pte Ltd" }, { type: "text_not_contains", value: "ABC Trading" }] },
    check: (page) => { assert(page.url.endsWith("/invoices/42")); assert(page.text.includes("Status: Draft")); } },
  { id: "draft-strict-review", path: "/draft", goal: "Save a draft and inspect it at review, without publishing.",
    options: { values: { name: "Delivery Note", notes: "Local scenario validation" }, reviewMode: "strict", constraints: ["Do not publish the record"], milestones: [
      { id: "save", goal: "Save a draft with Record name Delivery Note and Notes Local scenario validation until the Draft saved: DRAFT-42 confirmation appears", success_criteria: ["Draft saved DRAFT-42 is visible", "Record name displays Delivery Note and Notes displays Local scenario validation"], assertions: [{ type: "text_contains", value: "Draft saved: DRAFT-42" }, { type: "text_contains", value: "Record name: Delivery Note" }, { type: "text_contains", value: "Notes: Local scenario validation" }], guidance: ["Save draft saves the record and stays in the editor. Its button remains after a successful save; the Draft saved message confirms persistence. Continue to review belongs to the next milestone."] },
      { id: "review", goal: "Open review of DRAFT-42; leave the record in Draft status", assertions: [{ type: "text_contains", value: "Review ready" }, { type: "text_contains", value: "Status: Draft" }] },
    ] },
    strict: true,
    check: (page) => { assert(page.url.endsWith("/review")); assert.equal(fixture.state.drafts.length, 1); assert.equal(fixture.state.drafts[0].name, "Delivery Note"); assert.equal(fixture.state.publications, 0); } },
  { id: "login-handoff", path: "/login", goal: "Inspect the invoice list", expected: "needs_login", options: {}, check: (_page, result) => assert.equal(result.actions.length, 0) },
  { id: "captcha-handoff", path: "/captcha", goal: "Open the protected invoice list", expected: "blocked", options: {}, check: (_page, result) => assert.equal(result.actions.length, 0) },
  { id: "false-done-rejected", path: "/invoices/99", goal: "Inspect the visible invoice", expected: "verification_failed", options: { assertions: [{ type: "text_contains", value: "INV-42" }] }, check: (_page, result) => assert.equal(result.verification.assertions[0].passed, false) },
  { id: "async-scoped-date", path: "/async-record", goal: "Save an account with Company Name Globex Málaga, Contact Name Morgan Li and Renewal date December 31, 2026. Stop after the account saved confirmation.",
    options: { allowIrreversible: true, values: { company_name: "Globex Málaga", contact_name: "Morgan Li", renewal_date: "2026-12-31" }, successCriteria: ["Account saved confirmation is visible with Company Globex Málaga, Contact Morgan Li and Renewal 2026-12-31"], assertions: [
      { type: "text_contains", value: "Account saved: ASYNC-" }, { type: "field_equals", label: "Name", context: "Company", value: "Globex Málaga" },
      { type: "field_equals", label: "Name", context: "Contact", value: "Morgan Li" }, { type: "field_equals", label: "Renewal date", value: "2026-12-31" },
    ] }, check: (_page) => { assert.equal(fixture.state.delayedRecords.length, 1); assert.deepEqual(fixture.state.delayedRecords[0], { company: "Globex Málaga", contact: "Morgan Li", renewal: "2026-12-31" }); } },
  { id: "async-aria-switch", path: "/async-toggle", goal: "Enable Email notifications in Preferences and stop once Notifications enabled is visible.",
    options: { assertions: [{ type: "control_checked", label: "Email notifications", value: true }, { type: "text_contains", value: "Notifications enabled" }] },
    check: (page) => { assert.equal(page.elements.find((e) => e.role === "switch").checked, true); assert.equal(fixture.state.notifications, 1); } },
  { id: "duplicate-large-select", path: "/large-select", goal: "Set Region to the Central option with code central-south and apply it until Applied region: central-south is visible. central-north is not the requested region.",
    options: { assertions: [{ type: "field_equals", label: "Region", value: "central-south" }, { type: "text_contains", value: "Applied region: central-south" }] },
    check: () => { assert.deepEqual(fixture.state.regions, [{ region: "central-south" }]); } },
  { id: "modal-portal-combobox", path: "/portal-picker", goal: "Choose Helsinki in Dispatch city, apply the city, and stop when Applied city: Helsinki is visible.",
    options: { assertions: [{ type: "text_contains", value: "Applied city: Helsinki" }], constraints: ["Do not select Oslo"] },
    check: () => { assert.deepEqual(fixture.state.portalCities, [{ city: "Helsinki" }]); } },
];

try {
  await runtime.ensureReady();
  if (!tabId) tabId = (await runtime.kapture.newTab()).tabId;
  console.log(`Test tab: ${tabId}; provider: OpenRouter Jev; fixture: ${fixture.base}`);
  for (const scenario of scenarios.filter((s) => !process.env.JEVSTEER_SCENARIO || process.env.JEVSTEER_SCENARIO.split(",").includes(s.id))) {
    console.log(`START ${scenario.id}`);
    await runtime.kapture.navigate(tabId, fixture.base + scenario.path);
    let result;
    let initial;
    try {
      result = await runtime.run(scenario.goal, { ...scenario.options, tabId, maxActions: 16, explain: true });
      initial = result;
      if (scenario.strict) {
        assert.equal(result.status, "milestone_ready_for_review");
        assert.equal(result.next_milestone_index, 1);
        assert.equal(fixture.state.publications, 0);
        assert.equal(new URL((await runtime.snapshot(tabId)).url).pathname, "/draft");
        result = await runtime.run(scenario.goal, { ...scenario.options, tabId, runId: result.run_id, milestoneIndex: result.next_milestone_index, maxActions: 16, explain: true });
        assert.equal(result.status, "milestone_ready_for_review");
        assert.equal(result.plan_complete_after_review, true);
      } else assert.equal(result.status, scenario.expected || "completed_verified");
      const page = await runtime.snapshot(tabId);
      scenario.check(page, result);
      results.push({ id: scenario.id, passed: true, result, ...(scenario.strict ? { first_milestone: initial } : {}) });
      console.log(`PASS ${scenario.id}: ${result.status} (${result.jev_calls ?? "milestone"} calls)`);
    } catch (error) {
      results.push({ id: scenario.id, passed: false, error: error.message, result, ...(scenario.strict ? { first_milestone: initial } : {}) });
      console.log(`FAIL ${scenario.id}: ${error.message}`);
      // A failed semantic verifier is still a failed scenario. Independently
      // proved site state can only resolve its journal, not change its score.
      try {
        const page = await runtime.snapshot(tabId);
        scenario.check(page, result);
        for (const pending of result?.pending_actions || []) {
          await runtime.resolveAction({ tabId, actionId: pending.action_id, resolution: "applied", evidence: `Fixture state and independent checks proved ${scenario.id}'s action outcome; the scenario itself remains failed` });
        }
      } catch {}
    }
    await mkdir(join(output, ".."), { recursive: true });
    await writeFile(output, JSON.stringify({ provider: "openrouter", model: "jev-latest", tabId, results, fixture_state: fixture.state }, null, 2));
  }
} finally {
  await runtime.close();
  // Keep the tab usable after this fixture server exits.
  if (tabId) await runtime.kapture.navigate(tabId, "http://127.0.0.1:61823/").catch(() => {});
  await fixture.close();
}
if (results.some((r) => !r.passed)) process.exitCode = 1;
console.log(`RESULT ${results.filter((r) => r.passed).length}/${results.length} passed; saved ${output}`);
