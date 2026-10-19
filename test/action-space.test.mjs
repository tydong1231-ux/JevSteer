import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetSpace, availableTools } from "../src/decision-space.mjs";
import { FIELDISH, brief } from "../src/page-model.mjs";
import { rememberField } from "../src/element-identity.mjs";
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

test("an open combobox is not a SELECT target; a field known only by its hint can be typed into", () => {
  const space = buildTargetSpace([
    { i: 0, selector: "#customer", tag: "input", role: "combobox", label: "Customer", value: "", expanded: true },
    { i: 1, selector: "#terms", tag: "input", role: "combobox", label: "Payment Terms", value: "", expanded: false },
    { i: 2, selector: "#search", tag: "input", type: "text", role: "textbox", label: "", hint: "Search contacts, vendor bills..." },
    { i: 3, selector: "#qty", tag: "input", type: "text", role: "textbox", label: "QTY", column: "QTY", record_key: "line-1" },
  ]);
  assert.deepEqual(space.candidates.select.map((c) => c.key), ["1"]);
  assert.deepEqual(space.candidates.type.map((c) => c.key), ["0", "1", "2", "3"]);
  assert.equal(space.questions.type_target.criteria["2"].control, '[2] textbox "Search contacts, vendor bills..."');
  assert.equal(space.questions.type_target.criteria["3"].table_column, "QTY");
});

test("an open combobox offers the options its popup lists for SELECT; choosing one clicks it", () => {
  const elements = [
    { i: 0, selector: "#customer", tag: "input", role: "combobox", label: "Customer", value: "Acme", expanded: true },
    { i: 1, selector: "#currency", tag: "input", role: "combobox", label: "Currency", value: "", display: "SGD", expanded: false },
    { i: 2, selector: "#acme", tag: "div", role: "option", label: "Acme Ltd", popup_of: 0, selected: false },
    { i: 3, selector: "#acme-old", tag: "div", role: "option", label: "Acme Old", popup_of: 0, disabled: true },
    { i: 4, selector: "#beta", tag: "div", role: "option", label: "Beta LLC", popup_of: 0, selected: true },
    { i: 5, selector: "#other", tag: "div", role: "option", label: "Standalone" },
  ];
  const space = buildTargetSpace(elements);
  // Enabled, unselected options of the open combobox; the closed one as before.
  assert.deepEqual(space.candidates.select.map((c) => c.key), ["0>2", "1"]);
  assert.equal(space.questions.select_target.criteria["0>2"].control, '[0] combobox "Customer"');
  assert.equal(space.questions.select_target.criteria["0>2"].choose_option, "Acme Ltd");
  // A second-stage question sees part of the page; the options come from all of it.
  assert.deepEqual(buildTargetSpace(elements.slice(0, 2), elements).candidates.select.map((c) => c.key), ["0>2", "1"]);
  const runtime = new JevSteerRuntime();
  const action = runtime.resolve({ url: "https://erp.test/invoices/new", elements }, {
    tool: { choice: "select", probabilities: { select: 0.7 } },
    select_target: choice(space.questions.select_target.criteria, "0>2"),
  }, { customer: "Acme" });
  assert.deepEqual([action.tool, action.chosen_as, action.target, action.el.selector, action.value, action.p_target], ["click", "select", 2, "#acme", undefined, 1]);
});

test("a head with one target can turn it down", () => {
  const elements = [
    { i: 0, selector: "#search", tag: "input", type: "text", role: "textbox", label: "", hint: "Search contacts", value: "CP-MEIJI", type_completed: true },
    { i: 1, selector: "#size", tag: "input", role: "combobox", label: "Page Size", value: "20" },
  ];
  const space = buildTargetSpace(elements);
  // After the search box was typed, "Page Size" is the only TYPE target left.
  assert.deepEqual(Object.keys(space.questions.type_target.criteria), ["1", "__none__"]);
  assert.deepEqual(Object.keys(space.questions.click_target.criteria), ["0", "1"]);
  const runtime = new JevSteerRuntime();
  const action = runtime.resolve({ url: "https://erp.test/bills", elements }, {
    tool: { choice: "type", probabilities: { type: 0.6 } },
    type_target: choice(space.questions.type_target.criteria, "__none__"),
  }, { vendor: "CP-MEIJI" });
  assert.deepEqual([action.declined, action.target, action.el, action.candidates[0].element], [true, null, undefined, "none of the targets"]);
});

// ccMonet's global search box is known only by the hint drawn over it, which
// goes once it holds a value. Jev is offered the box with that hint for
// Enter; the choice must resolve to the same box, not to nothing.
test("Enter chosen for a typed box known only by its hint goes to that box", async () => {
  const box = { i: 0, selector: "#search", tag: "input", type: "text", role: "textbox", hint: "Search contacts, vendor bills...", value: "" };
  const before = { url: "https://erp.test/bills", title: "Bills", text: "Vendor Bills", metrics: {}, elements: [box, { i: 1, selector: "#size", tag: "input", role: "combobox", label: "Page Size", value: "20" }] };
  const typed = [{ field: rememberField(box, before), url: before.url, value: "CP-MEIJI" }];
  const typedBox = { ...box, value: "CP-MEIJI" };
  delete typedBox.hint;
  const page = { ...before, elements: [typedBox, before.elements[1]] };
  let offered;
  const runtime = new JevSteerRuntime({ decider: async (_state, questions) => {
    offered = questions;
    return { answers: { tool: { choice: "press_enter", probabilities: { press_enter: 0.9 } }, press_enter_target: choice(questions.press_enter_target.criteria, "0") }, ms: 1, tokens: 1 };
  } });
  const values = { vendor: "CP-MEIJI" };
  const answer = await runtime.decide(page, normalizeTaskContract({ goal: "Search for vendor CP-MEIJI" }), values, [], null, null, typed);
  assert.equal(offered.press_enter_target.criteria["0"].control, '[0] textbox "Search contacts, vendor bills..."');
  assert.deepEqual(Object.keys(offered.type_target.criteria), ["1", "__none__"]);
  const action = runtime.resolve(page, answer, values);
  assert.deepEqual([action.tool, action.target, action.el?.selector, action.p_target], ["press_enter", 0, "#search", 1]);
  // Described as Jev saw it, in history and to the guards.
  assert.equal(brief(action.el), 'textbox "Search contacts, vendor bills..."');
});

test("on a page too large for one decision, the groups Jev picks from show a typed box by its hint", async () => {
  const box = { i: 0, selector: "#search", tag: "input", type: "text", role: "textbox", hint: "Search contacts, vendor bills...", value: "" };
  const bills = Array.from({ length: 300 }, (_, n) => ({ i: n + 1, selector: `#bill-${n}`, tag: "a", role: "link", label: `Bill ${n}`, href: `https://erp.test/bills/${n}` }));
  const before = { url: "https://erp.test/bills", title: "Bills", text: "Vendor Bills", metrics: {}, elements: [box, ...bills] };
  const typed = [{ field: rememberField(box, before), url: before.url, value: "CP-MEIJI" }];
  const typedBox = { ...box, value: "CP-MEIJI" };
  delete typedBox.hint;
  const page = { ...before, elements: [typedBox, ...bills] };
  const calls = [];
  const runtime = new JevSteerRuntime({ decider: async (_state, questions) => {
    calls.push(questions);
    const answers = questions.group
      ? { tool: { choice: "press_enter", probabilities: { press_enter: 0.9 } }, group: { choice: "0", probabilities: { 0: 0.99 } } }
      : { press_enter_target: choice(questions.press_enter_target.criteria, "0") };
    return { answers, ms: 1, tokens: 1 };
  } });
  const values = { vendor: "CP-MEIJI" };
  const answer = await runtime.decide(page, normalizeTaskContract({ goal: "Search for vendor CP-MEIJI" }), values, [], null, null, typed);
  assert.equal(answer.stages, 2);
  assert.match(calls[0].group.criteria["0"], /^\[0\] textbox "Search contacts, vendor bills\.\.\." \| \[1\] link "Bill 0" \| /);
  const action = runtime.resolve(page, answer, values);
  assert.deepEqual([action.tool, action.el?.selector], ["press_enter", "#search"]);
});

test("a combobox that shows an option counts as typed only when the option holds the typed text as whole words", async () => {
  const country = { i: 0, selector: "#country", tag: "input", role: "combobox", label: "Country", value: "" };
  const reference = { i: 1, selector: "#ref", tag: "input", type: "text", role: "textbox", label: "Reference", value: "" };
  // What was typed, what the combobox shows once an option was picked, and
  // whether it is offered for TYPE again.
  for (const [typedText, shows, typable] of [
    ["US", "Australia", true],
    ["1", "10", true],
    ["Acme", "Acme Ltd", false],
    ["US", "United States (US)", false],
    ["Acme, Inc.", "Acme, Inc.", false],
    ["Beta", "Alpha, Beta", false],
    ["北京", "北京市", false],
  ]) {
    const before = { url: "https://erp.test/customer", title: "New customer", text: "New customer", metrics: {}, elements: [{ ...country, value: typedText }, reference] };
    const typed = [{ field: rememberField(before.elements[0], before), url: before.url, value: typedText }];
    const page = { ...before, elements: [{ ...country, display: shows }, reference] };
    let offered;
    const runtime = new JevSteerRuntime({ decider: async (_state, questions) => {
      offered = questions;
      return { answers: { tool: { choice: "none", probabilities: { none: 1 } } }, ms: 1, tokens: 1 };
    } });
    await runtime.decide(page, normalizeTaskContract({ goal: "Fill in the new customer" }), {}, [], null, null, typed);
    assert.equal(Object.keys(offered.type_target.criteria).includes("0"), typable, `typed ${typedText}, shows ${shows}`);
  }
});

test("DONE is judged by the success criteria when the host gives them", async () => {
  const asked = [];
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    asked.push(questions.done.instructions);
    return { answers: { ...Object.fromEntries(Object.entries(questions).filter(([, q]) => q.type === "noul").map(([k]) => [k, { noul: 0.01 }])), tool: { choice: "none", probabilities: { none: 1 } } }, ms: 1, tokens: 1 };
  } });
  const p = page();
  await runtime.decide(p, normalizeTaskContract({ goal: "Search for vendor CP-MEIJI", successCriteria: ["Search results list CP-MEIJI CO.,LTD."] }), {}, []);
  await runtime.decide(p, normalizeTaskContract({ goal: "Search for vendor CP-MEIJI" }), {}, []);
  assert.match(asked[0], /task\.success_criteria say what achieved looks like: check each of them against page as it is now, including page\.popup\.$/);
  assert.doesNotMatch(asked[1], /success_criteria/);
});

test("the value chooser sees a field's table column and hint", async () => {
  let selected;
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    selected = state.selected_field;
    return { answers: { selected_value: choice(questions.selected_value.criteria, "__none__") }, ms: 1, tokens: 4 };
  } });
  const line = { i: 0, selector: "#product", tag: "input", role: "combobox", label: "Preferred Name", column: "Preferred Name", hint: "Select product", record_key: "line-1", value: "" };
  const value = await runtime.chooseFieldValue({ url: "https://erp.test", title: "Invoice", text: "Invoice", elements: [line] },
    normalizeTaskContract({ goal: "Create an invoice for JevSteer QA" }), { customer_name: "JevSteer QA", quantity: "2" }, [], line);
  assert.equal(value, undefined);
  assert.equal(selected.table_column, "Preferred Name");
  assert.equal(selected.hint, "Select product");
});

test("exact host field assertions bind start and end values without another model choice", async () => {
  const runtime = new JevSteerRuntime({ decider: async () => { throw new Error("must not guess an explicit binding"); } });
  const p={elements:[{i:0,selector:"#from",label:"Start date"},{i:1,selector:"#to",label:"End date"}]};
  const contract=normalizeTaskContract({goal:"Q2",assertions:[{type:"field_equals",label:"Start date",value:"2026/4/1"},{type:"field_equals",label:"End date",value:"2026/6/30"}]});
  const values={start_date:"2026/4/1",end_date:"2026/6/30"};
  assert.equal(await runtime.chooseFieldValue(p,contract,values,[],{...p.elements[0]}),"start_date");
  assert.equal(await runtime.chooseFieldValue(p,contract,values,[],{...p.elements[1]}),"end_date");
});

test("conflicting, ambiguous and missing host field bindings fail closed", async () => {
  const runtime = new JevSteerRuntime({ decider: async () => { throw new Error("must not guess an explicit binding"); } });
  const p={elements:[{selector:"#one",label:"Date"},{selector:"#two",label:"Date"}]};
  const ambiguous=normalizeTaskContract({goal:"Inspect",assertions:[{type:"field_equals",label:"Date",value:"one"}]});
  assert.equal(await runtime.chooseFieldValue(p,ambiguous,{a:"one",b:"two"},[],p.elements[0]),undefined);
  const single={elements:[p.elements[0]]};
  const conflict=normalizeTaskContract({goal:"Inspect",assertions:[{type:"field_equals",label:"Date",value:"one"},{type:"field_equals",label:"Date",value:"two"}]});
  assert.equal(await runtime.chooseFieldValue(single,conflict,{a:"one",b:"two"},[],p.elements[0]),undefined);
  assert.equal(await runtime.chooseFieldValue(single,ambiguous,{a:"missing",b:"other"},[],p.elements[0]),undefined);
  assert.equal(await runtime.chooseFieldValue(single,ambiguous,{a:"one",b:"one"},[],p.elements[0]),undefined);
});

test("host field binding uses record context to distinguish equal labels", async () => {
  const runtime = new JevSteerRuntime({ decider: async () => { throw new Error("must not guess an explicit binding"); } });
  const p={elements:[{selector:"#one",label:"Name",context:"Customer"},{selector:"#two",label:"Name",context:"Contact"}]};
  const contract=normalizeTaskContract({goal:"Fill",assertions:[{type:"field_equals",label:"Name",context:"Customer",value:"Acme"},{type:"field_equals",label:"Name",context:"Contact",value:"Morgan"}]});
  assert.equal(await runtime.chooseFieldValue(p,contract,{company:"Acme",person:"Morgan"},[],p.elements[1]),"person");
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
