import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetSpace, availableTools } from "../src/decision-space.mjs";
import { FIELDISH } from "../src/page-model.mjs";
import { OfflineRuntime as JevSteerRuntime } from "./helpers/runtime.mjs";
import { normalizeTaskContract } from "../src/task-contract.mjs";

function page() {
  return {
    url: "https://example.test/form", title: "Form", text: "Customer Email Send Priority",
    metrics: {},
    elements: [
      { i: 0, selector: "#notify", tag: "input", type: "checkbox", role: "checkbox", label: "Notify", checked: false },
      { i: 1, selector: "#email", tag: "input", type: "email", role: "textbox", label: "Email", value: "" },
      { i: 2, selector: "#send", tag: "button", role: "button", label: "Send" },
      { i: 3, selector: "#priority", tag: "select", role: "combobox", label: "Priority", value: "low", options: [
        { text: "Low", value: "low", selected: true, disabled: false },
        { text: "Normal", value: "normal", selected: false, disabled: false },
        { text: "Urgent", value: "urgent", selected: false, disabled: false },
      ] },
      { i: 4, selector: "#locked", tag: "input", type: "text", role: "textbox", label: "Read only", readonly: true },
    ],
  };
}

function choice(criteria, preferred) {
  const keys = Object.keys(criteria);
  assert.ok(keys.length);
  const selected = preferred && keys.includes(preferred) ? preferred : keys[0];
  return { choice: selected, probabilities: Object.fromEntries(keys.map(k => [k, Number(k === selected)])) };
}

test("speculative action heads only contain type-compatible enabled controls and selectable options", () => {
  const p = page();
  assert.equal(FIELDISH(p.elements[0]), false);
  assert.equal(FIELDISH(p.elements[4]), false);
  const space = buildTargetSpace(p.elements);
  assert.deepEqual(space.candidates.type.map(c => c.key), ["1"]);
  assert.deepEqual(space.candidates.select.map(c => c.key), ["3:1", "3:2"]);
  assert.ok(space.questions.click_target.criteria["0"]);
  assert.ok(!space.questions.type_target.criteria["0"]);
  assert.equal(space.questions.select_target.criteria["3:2"].choose_option, "Urgent");
  assert.ok(availableTools({ click: "", type: "", none: "" }, space).type !== undefined);
  assert.ok(!buildTargetSpace([]).questions.click_target);
});

test("tool-specific target heads are batched in one Jev request and never cross-consumed", async () => {
  const observed = [];
  const fake = async (state, questions) => {
    observed.push({ state, questions });
    const answers = {};
    for (const [name, q] of Object.entries(questions)) {
      if (q.type === "noul") answers[name] = { noul: 0.01 };
      else if (name === "tool") answers[name] = choice(q.criteria, "type");
      else if (name === "click_target") answers[name] = choice(q.criteria, "2");
      else if (name === "type_target") answers[name] = choice(q.criteria, "1");
      else answers[name] = choice(q.criteria);
    }
    return { answers, ms: 2, tokens: 15 };
  };
  const runtime = new JevSteerRuntime({ decider: fake });
  const p = page();
  const value = { email: "hello@example.test" };
  const answer = await runtime.decide(p, normalizeTaskContract({ goal: "Enter an email" }), value, []);
  assert.equal(observed.length, 1);
  assert.ok(observed[0].questions.click_target);
  assert.ok(observed[0].questions.type_target);
  assert.equal(observed[0].questions.target, undefined);
  const action = runtime.resolve(p, answer, value);
  assert.equal(action.tool, "type");
  assert.equal(action.el.selector, "#email");
  assert.equal(action.value, "hello@example.test");
});

test("native select picks a particular option in the same Jev request", () => {
  const runtime = new JevSteerRuntime();
  const p = page();
  const answer = {
    tool: { choice: "select", probabilities: { select: 1 } },
    select_target: choice(buildTargetSpace(p.elements).questions.select_target.criteria, "3:2"),
  };
  const action = runtime.resolve(p, answer, {});
  assert.equal(action.target, 3);
  assert.equal(action.el.selector, "#priority");
  assert.equal(action.value, "urgent");
  assert.equal(action.p_target, 1);
});

test("multiple value mapping is deferred until the selected field is known", async () => {
  const observed = [];
  const decider = async (state, questions) => {
    observed.push({ state, questions });
    assert.deepEqual(Object.keys(questions), ["selected_value"]);
    return { answers: { selected_value: choice(questions.selected_value.criteria, "email") }, ms: 1, tokens: 4 };
  };
  const runtime = new JevSteerRuntime({ decider });
  const p = page();
  const value = await runtime.chooseFieldValue(
    p, normalizeTaskContract({ goal: "Complete form" }),
    { email: "hi@example.test", customer: "Northstar Inc." }, [], p.elements[1]
  );
  assert.equal(value, "email");
  assert.equal(observed[0].state.selected_field.label, "Email");
});

test("stale or occluded targets stop before any browser mutation", async () => {
  const calls = [];
  const fakeKapture = {
    async elements() {
      return { url: "https://example.test/form", elements: [] };
    },
    async command(_tab, command) {
      calls.push(command);
      return { success: true };
    },
  };
  const runtime = new JevSteerRuntime({ kapture: fakeKapture });
  await assert.rejects(
    runtime.act("tab1", {
      tool: "click", target: 2, observedUrl: "https://example.test/form",
      el: page().elements[2],
    }),
    /STALE_TARGET/
  );
  assert.deepEqual(calls, []);
});

test("page navigation after prediction prevents using the old target", async () => {
  let executed = false;
  const runtime = new JevSteerRuntime({
    kapture: {
      async elements() {
        return { url: "https://example.test/other", elements: [{ visible: true, selector: "#send", tagName: "button" }] };
      },
      async command() { executed = true; },
    },
  });
  await assert.rejects(runtime.act("tab1", {
    tool: "click", target: 2, observedUrl: "https://example.test/form",
    el: page().elements[2],
  }), /navigated/);
  assert.equal(executed, false);
});

test("ordinary field values can be generated without host-provided values", async () => {
  const writes = [];
  const fake = {
    text: "",
    async listTabs() { return [{tabId:"t1",url:"https://example.test/form",pageVisibility:{visible:true}}]; },
    async elements(_tab,selector) {
      return {url:"https://example.test/form",elements:[{
        selector, visible:true, tagName:"input", value:this.text,
      }]};
    },
    async command(_tab,name,body) {
      if (name === "fill") { this.text = body.value; writes.push(body.value); }
      if (name === "network_requests") return {requests:[],cursor:0};
      return {success:true};
    },
    async close() {},
  };
  const decisions = async (state,questions) => {
    if (questions.goal_complete) {
      return {answers:Object.fromEntries(Object.keys(questions).map(name=>[name,{noul:0.99}])),ms:1,tokens:10};
    }
    const done = state.page.elements.some(e=>e.label==="Email"&&e.value==="London");
    const answers = {};
    for (const [name,q] of Object.entries(questions)) {
      if (q.type==="noul") answers[name]={noul:["done","done_change"].includes(name)
        ? Number(done?0.99:0.01) : (["on_track","next_step_clear"].includes(name) ? 0.99 : 0.01)};
      else if (name==="tool") answers[name]=choice(q.criteria,done?"none":"type");
      else if (name==="type_target") answers[name]=choice(q.criteria,"1");
      else answers[name]=choice(q.criteria);
    }
    return {answers,ms:1,tokens:10};
  };
  let helperCount=0;
  const runtime = new JevSteerRuntime({
    kapture:fake,
    decider:decisions,
    snapshotter:async () => {
      const p=page();p.elements[1].value=fake.text;
      return p;
    },
    leases:{async withLease(_tab,_owner,fn){return fn();}},
    textGenerator:async args=>{
      helperCount++;
      assert.equal(args.field.label,"Email");
      return {text:"London",status:"ok"};
    },
  });
  runtime.settle=async()=>0;
  const result=await runtime.run("Enter London into Email", {maxActions:3});
  assert.equal(result.status,"completed_verified");
  assert.deepEqual(writes,["London"]);
  assert.equal(helperCount,1);
  assert.equal(result.text_helper_calls,1);
});
