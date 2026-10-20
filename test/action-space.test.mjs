import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetSpace, availableTools, listToScroll } from "../src/decision-space.mjs";
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
    return { answers: { selected_value: choice(questions.selected_value.criteria, "contact") }, ms: 1, tokens: 4 };
  };
  const runtime = new JevSteerRuntime({ decider });
  const p = page();
  const value = await runtime.chooseFieldValue(
    p, normalizeTaskContract({ goal: "Complete form" }),
    { contact: "hi@example.test", customer: "Northstar Inc." }, [], p.elements[1]
  );
  assert.equal(value, "contact");
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

test("unnamed selects are told apart in the target heads by what they show", () => {
  const space = buildTargetSpace([
    { i: 0, selector: "#field", tag: "input", role: "combobox", label: "", value: "", display: "Status", expanded: false },
    { i: 1, selector: "#op", tag: "input", role: "combobox", label: "", value: "", display: "Is", expanded: false },
    { i: 2, selector: "#value", tag: "input", role: "combobox", label: "", value: "", display: "Draft", expanded: false },
    { i: 3, selector: "#password", tag: "input", type: "password", role: "combobox", label: "Password", value: "", display: "hunter2", expanded: false },
  ]);
  const shows = (tool) => Object.fromEntries(Object.entries(space.questions[`${tool}_target`].criteria).map(([key, c]) => [key, c.shows]));
  assert.deepEqual(shows("select"), { 0: "Status", 1: "Is", 2: "Draft", 3: undefined });
  assert.deepEqual(shows("click"), { 0: "Status", 1: "Is", 2: "Draft", 3: undefined });
});

// ccMonet's bill filter: the field select takes typing, and only what it
// shows ("Status") tells it from the operator and value beside it. It was
// never offered for TYPE (Mac rerun on 9a83708).
test("an unnamed select that takes typing is a TYPE target known by what it shows, and the value chooser hears it", async () => {
  const field = { i: 0, selector: "#field", tag: "input", type: "search", role: "combobox", label: "", value: "", display: "Status", expanded: true };
  const space = buildTargetSpace([
    field,
    { i: 1, selector: "#op", tag: "input", type: "search", role: "combobox", label: "", value: "", display: "Is", readonly: true, expanded: false },
    { i: 2, selector: "#blank", tag: "input", type: "search", role: "combobox", label: "", value: "", expanded: false },
    { i: 3, selector: "#pin", tag: "input", type: "password", role: "combobox", label: "", value: "", display: "1234", expanded: false },
  ]);
  assert.deepEqual(space.candidates.type.map((c) => c.key), ["0"]);
  assert.deepEqual(space.questions.type_target.criteria["0"], { control: "[0] combobox", current_value: "", shows: "Status" });
  let seen;
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    seen = { state, question: questions.selected_value };
    return { answers: { selected_value: choice(questions.selected_value.criteria, "filter_field") }, ms: 1, tokens: 4 };
  } });
  const value = await runtime.chooseFieldValue({ url: "https://erp.test/bills", title: "Bills", text: "Bills Filter records", elements: [field] },
    normalizeTaskContract({ goal: "Filter bills by vendor" }), { filter_field: "Vendor", vendor: "CP-MEIJI CO.,LTD." }, [], field);
  assert.equal(value, "filter_field");
  assert.equal(seen.state.selected_field.shows, "Status");
  assert.match(seen.question.instructions, /a select with no label is known by what it shows now \(shows\)\./);
});

// ccMonet's filter field list draws only the options in view; "Vendor" lay
// below them (Mac rerun, 2026-10-20).
test("SCROLL turns the one open list that holds more options below, over an option it shows", async () => {
  const field = { i: 0, selector: "#field", tag: "input", role: "combobox", label: "", display: "Status", expanded: true, more_options: "below", readonly: true };
  const options = [1, 2, 3].map((i) => ({ i, selector: `#o${i}`, tag: "div", role: "option", label: `Field ${i}`, popup_of: 0, selected: i === 1 }));
  const p = { url: "https://erp.test/bills", title: "Bills", text: "Filter records", elements: [field, ...options] };
  assert.deepEqual(listToScroll(p.elements), { list: field, option: options[2] });
  for (const other of [{ more_options: "above" }, { more_options: undefined }, { expanded: false }]) {
    assert.equal(listToScroll([{ ...field, ...other }, ...options]), undefined);
  }
  // Two such lists: which one is not known.
  assert.equal(listToScroll([field, ...options, { ...field, i: 4, selector: "#op" }, { ...options[0], i: 5, selector: "#p5", popup_of: 4 }]), undefined);

  let tool;
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    tool = questions.tool;
    const answers = Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, q.type === "noul" ? { noul: 0.01 } : choice(q.criteria, "scroll")]));
    return { answers, ms: 1, tokens: 1 };
  } });
  const answer = await runtime.decide(p, normalizeTaskContract({ goal: "Filter bills by Vendor" }), {}, []);
  assert.equal(tool.criteria.scroll, 'Scroll the open list of [0] combobox down, to show more of its options');
  assert.match(tool.instructions, /The open list of \[0\] combobox holds more options below the ones page\.elements show \(more_options\): if the option task\.goal needs is not among them, choose SCROLL\.$/);
  const action = runtime.resolve(p, answer, {});
  assert.deepEqual([action.tool, action.target, action.el.selector, action.scrolls.selector], ["scroll", 3, "#o3", "#field"]);
  // With no such list, SCROLL scrolls the page, and Jev is told nothing more.
  const plain = { ...p, elements: [{ ...field, more_options: undefined }, ...options] };
  const again = await runtime.decide(plain, normalizeTaskContract({ goal: "Filter bills by Vendor" }), {}, []);
  assert.equal(tool.criteria.scroll, "Scroll down to reveal or load more content");
  assert.doesNotMatch(tool.instructions, /more_options/);
  assert.deepEqual([runtime.resolve(plain, again, {}).target, runtime.resolve(plain, again, {}).scrolls], [null, undefined]);
});

// ccMonet's invoice (Mac run on 3fa0a57): Jev scrolled the open Customer
// list instead of typing the customer's name into its search, and stopped.
test("an open combobox that takes typing is named to Jev as one to type an option's text into, rather than scroll", async () => {
  const customer = { i: 0, selector: "#customer", tag: "input", role: "combobox", label: "Customer", value: "", expanded: true, more_options: "below" };
  const options = [1, 2].map((i) => ({ i, selector: `#o${i}`, tag: "div", role: "option", label: `Customer ${i}`, popup_of: 0 }));
  let tool;
  let clear;
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    tool = questions.tool;
    clear = questions.next_step_clear;
    const answers = Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, q.type === "noul" ? { noul: 0.01 } : choice(q.criteria, "none")]));
    return { answers, ms: 1, tokens: 1 };
  } });
  const look = (field) => runtime.decide({ url: "https://erp.test/invoices/new", title: "New Invoice", text: "New Invoice", elements: [{ ...customer, ...field }, ...options] },
    normalizeTaskContract({ goal: "Bill JevSteer QA CHAIN1020A" }), { customer: "JevSteer QA CHAIN1020A", amount: "50" }, []);
  const note = '[0] combobox "Customer" is open and takes typing: it lists the options that match what is typed there. To reach an option its open list does not show, TYPE the option\'s text (as task.values or task.guidance give it) into the combobox, rather than scrolling the list.';
  // Whether the next step is clear is asked apart: it is told too (ccMonet's
  // Category, Mac run on 37c131e).
  const clearNote = '[0] combobox "Customer" is open and takes typing: typing into it the text of an option that task.values or task.guidance give for that field is a clear next step.';
  await look({});
  assert.ok(tool.instructions.endsWith(`${note} Choose SCROLL only to look through options whose text they do not give.`), tool.instructions);
  assert.doesNotMatch(tool.instructions, /more_options/);
  assert.ok(clear.instructions.endsWith(`multiple business transitions are similarly plausible. ${clearNote}`), clear.instructions);
  await look({ more_options: undefined });
  assert.ok(tool.instructions.endsWith(note), tool.instructions);
  assert.ok(clear.instructions.endsWith(clearNote), clear.instructions);
  // One that takes no typing (antd's select without search keeps its input
  // read-only), or a closed one, is not named. Its list is scrolled.
  for (const [other, scrolled] of [[{ readonly: true }, true], [{ expanded: false }, false]]) {
    await look(other);
    assert.doesNotMatch(tool.instructions, /takes typing/);
    assert.equal(/more_options/.test(tool.instructions), scrolled);
    assert.ok(clear.instructions.endsWith("multiple business transitions are similarly plausible."), clear.instructions);
  }
});

test("fields of two table rows are told apart in the target heads by their row", () => {
  const space = buildTargetSpace([
    { i: 0, selector: "#price-1", tag: "input", role: "textbox", label: "Unit Price", column: "Unit Price", row: 1, value: "100" },
    { i: 1, selector: "#price-2", tag: "input", role: "textbox", label: "Unit Price", column: "Unit Price", row: 2, value: "" },
    { i: 2, selector: "#tracking-2", tag: "input", role: "combobox", label: "", column: "Tracking Category", row: 2, value: "", display: "Woodlands" },
    { i: 3, selector: "#clear-2", tag: "span", role: "button", label: "close-circle", clears: 2, column: "Tracking Category", row: 2 },
  ]);
  const type = space.questions.type_target.criteria;
  assert.deepEqual([type["0"].table_row, type["1"].table_row], [1, 2]);
  assert.equal(space.questions.click_target.criteria["3"].clears, '[2] combobox in column "Tracking Category" in table row 2 showing "Woodlands"');
});

// ccMonet marks an invoice line's required fields on the column header, and
// one a save refused by an error class on its cell (see the snapshot).
test("the target heads say which fields the page marks required or invalid", () => {
  const space = buildTargetSpace([
    { i: 0, selector: "#name", tag: "input", role: "textbox", label: "Preferred Name", column: "Preferred Name", row: 1, value: "", required: true },
    { i: 1, selector: "#tracking", tag: "input", role: "combobox", label: "Tracking Category", column: "Tracking Category", row: 1, value: "", required: true, invalid: false, error_mark: true },
    { i: 2, selector: "#email", tag: "input", role: "textbox", label: "Email", value: "x", invalid: true },
    { i: 3, selector: "#memo", tag: "input", role: "textbox", label: "Memo", value: "" },
  ]);
  const marks = (criteria) => Object.fromEntries(Object.entries(criteria).map(([key, c]) => [key, [!!c.required, !!c.invalid]]));
  // The TYPE head is told guidance says which field a value goes into.
  assert.match(space.questions.type_target.instructions, / Where task\.guidance says which field a value or a kind of text goes into \("Line item text goes into Description"\), type it there and in no other field, whatever another field's label suggests\./);
  assert.doesNotMatch(space.questions.select_target.instructions, /Line item text/);
  assert.deepEqual(marks(space.questions.type_target.criteria), { 0: [true, false], 1: [true, true], 2: [false, true], 3: [false, false] });
  assert.deepEqual(marks(space.questions.select_target.criteria)["1"], [true, true]);
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
  assert.equal(action.listed_in.selector, "#customer");
  // A CLICK on an option the open combobox lists, chosen or not, keeps that
  // combobox too, so the driver checks it the same way before input. An
  // option no open combobox lists is a plain click.
  const click = (target) => runtime.resolve({ url: "https://erp.test/invoices/new", elements }, {
    tool: { choice: "click", probabilities: { click: 0.7 } },
    click_target: { choice: String(target), probabilities: { [String(target)]: 0.9 } },
  }, {});
  assert.deepEqual([4, 5].map((i) => [click(i).el.selector, click(i).chosen_as, click(i).listed_in?.selector]), [["#beta", undefined, "#customer"], ["#other", undefined, undefined]]);
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

// ccMonet's Manual Match (Mac runs on 3fa0a57 and 37c131e): Jev found the
// deposit reconciled once it ticked the invoice, before Confirm match.
test("DONE and DONE_CHANGE are told that a choice on an open form or dialog is applied only by the control that applies it", async () => {
  let asked;
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    asked = questions;
    return { answers: { ...Object.fromEntries(Object.entries(questions).filter(([, q]) => q.type === "noul").map(([k]) => [k, { noul: 0.01 }])), tool: { choice: "none", probabilities: { none: 1 } } }, ms: 1, tokens: 1 };
  } });
  await runtime.decide(page(), normalizeTaskContract({ goal: "Reconcile the 50.00 deposit of 2026/4/17 with invoice INVMNB5Q" }), {}, []);
  const clause = "A choice made on an open form or dialog, such as a ticked checkbox, a chosen option or a typed value, is applied only when the control that applies it (Save, Confirm, Submit) is used after it. When task.history shows no use of that control since the choice, and page still shows the form or dialog with it, a goal that needs the choice saved, submitted, confirmed or matched is not achieved yet, unless page shows it applied, such as in a status or a message.";
  assert.ok(asked.done.instructions.endsWith(`has been achieved? ${clause}`), asked.done.instructions);
  assert.ok(asked.done_change.instructions.endsWith(`has task.goal been achieved? ${clause}`), asked.done_change.instructions);
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

// ccMonet's invoice (Mac rerun on 9a83708): the value chooser turned down
// due_date for Due Date, and the run stopped there.
test("a value named for the field it goes in is used without a question, for a field off any table line", async () => {
  const asked = [];
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    asked.push(state.selected_field.label);
    return { answers: { selected_value: choice(questions.selected_value.criteria, "__none__") }, ms: 1, tokens: 4 };
  } });
  const contract = normalizeTaskContract({ goal: "Fill the invoice lines" });
  const values = { due_date: "2026/11/19", unit_price: "100", memo: "QA" };
  const due = { i: 0, selector: "#due", tag: "input", role: "textbox", label: "Due Date", value: "" };
  const byName = { i: 1, selector: "#memo", tag: "textarea", role: "textbox", label: "Note", name: "memo", value: "" };
  const price = { i: 2, selector: "#price", tag: "input", role: "textbox", label: "Unit Price", column: "Unit Price", row: 1, value: "" };
  const p = { url: "https://erp.test", title: "Invoice", text: "Invoice", elements: [due, byName, price] };
  assert.equal(await runtime.chooseFieldValue(p, contract, values, [], due), "due_date");
  assert.equal(await runtime.chooseFieldValue(p, contract, values, [], byName), "memo");
  assert.deepEqual(asked, []);
  // A field on a table line is asked about: the lines hold different items.
  assert.equal(await runtime.chooseFieldValue(p, contract, values, [], price), undefined);
  // So is a field two values are named for.
  assert.equal(await runtime.chooseFieldValue(p, contract, { dueDate: "2026/11/19", due_date: "2026/11/20" }, [], due), undefined);
  assert.deepEqual(asked, ["Unit Price", "Due Date"]);
});

// The line's description, typed into its Description, also went into the
// invoice's own Description without a question (Mac rerun of 3fa0a57).
test("a value named for an off-table field is asked about once this run entered it, or when a table column bears the name", async () => {
  const asked = [];
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    asked.push(questions.selected_value.criteria.description);
    return { answers: { selected_value: choice(questions.selected_value.criteria, "__none__") }, ms: 1, tokens: 4 };
  } });
  const contract = normalizeTaskContract({ goal: "Fill the invoice line" });
  const values = { description: "QA test service", unit_price: "50" };
  const header = { i: 0, selector: "#notes", tag: "textarea", role: "textbox", label: "Description", value: "" };
  const line = { i: 1, selector: "#desc-1", tag: "textarea", role: "textbox", label: "Description", column: "Description", row: 1, value: "" };
  const alone = { url: "https://erp.test", title: "Invoice", text: "Invoice", elements: [header] };
  assert.equal(await runtime.chooseFieldValue(alone, contract, values, [], header), "description");
  assert.deepEqual(asked, []);
  // A table column bears the name too.
  assert.equal(await runtime.chooseFieldValue({ ...alone, elements: [header, line] }, contract, values, [], header), undefined);
  // This run already entered the value.
  const typed = [{ action: "type", element: 'textbox "Description"', row: 1, value: "description" }];
  assert.equal(await runtime.chooseFieldValue(alone, contract, values, typed, header), undefined);
  assert.deepEqual(asked, ["QA test service", 'QA test service (this run already entered it in textbox "Description" in table row 1)']);
});

// ccMonet's invoice (Mac rerun on 9a83708): with the guidance "Line item text
// goes into Description; Preferred Name picks a saved product.", the item
// text still went into Preferred Name.
test("the value chooser puts a value where task.guidance says it goes, whatever another field's label suggests", async () => {
  let question;
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    question = { guidance: state.task.guidance, instructions: questions.selected_value.instructions };
    return { answers: { selected_value: choice(questions.selected_value.criteria, "__none__") }, ms: 1, tokens: 4 };
  } });
  const product = { i: 0, selector: "#product", tag: "input", role: "combobox", label: "Preferred Name", column: "Preferred Name", row: 1, value: "" };
  const guidance = ["Line item text goes into Description; Preferred Name picks a saved product."];
  await runtime.chooseFieldValue({ url: "https://erp.test", title: "Invoice", text: "Invoice", elements: [product] },
    normalizeTaskContract({ goal: "Add the lines", guidance }), { item_a: "QA item A", price_a: "100" }, [], product);
  assert.deepEqual(question.guidance, guidance);
  assert.match(question.instructions, /task\.guidance comes from the host, who knows the site: where it says which field a value or a kind of text goes into \("Line item text goes into Description"\), that value belongs there and in no other field, whatever this field's label suggests\. Otherwise its explicit label and name are primary/);
});

// ccMonet's invoice lines have no key of their own, and line 2's Unit Price
// got line 1's price: nothing told the chooser which line it was filling.
test("the value chooser sees a field's table row and where each value was already entered", async () => {
  let seen;
  const runtime = new JevSteerRuntime({ decider: async (state, questions) => {
    seen = { state, question: questions.selected_value };
    return { answers: { selected_value: choice(questions.selected_value.criteria, "price_b") }, ms: 1, tokens: 4 };
  } });
  const price = { i: 4, selector: "#price-2", tag: "input", role: "textbox", label: "Unit Price", column: "Unit Price", row: 2, value: "" };
  const history = [
    { action: "type", element: 'textbox "Description"', row: 1, value: "item_a" },
    { action: "type", element: 'textbox "Unit Price"', row: 1, value: "price_a" },
    { action: "type", element: 'textbox "Description"', row: 2, value: "item_b" },
    { action: "type", element: 'textbox "Quantity"', row: 2, value: "qty_b", error: "the target never became ready for input; no input was sent" },
    { action: "type", element: 'textbox "Reference"', value: "reference", record: "Invoice draft" },
  ];
  const values = { item_a: "Consulting", price_a: "100", item_b: "Support", price_b: "50", qty_b: "1", reference: "PO-7" };
  const value = await runtime.chooseFieldValue({ url: "https://erp.test", title: "Invoice", text: "Invoice", elements: [price] },
    normalizeTaskContract({ goal: "Create an invoice with two lines" }), values, history, price);
  assert.equal(value, "price_b");
  assert.equal(seen.state.selected_field.table_row, 2);
  assert.deepEqual(seen.question.criteria, {
    item_a: 'Consulting (this run already entered it in textbox "Description" in table row 1)',
    price_a: '100 (this run already entered it in textbox "Unit Price" in table row 1)',
    item_b: 'Support (this run already entered it in textbox "Description" in table row 2)',
    // An attempt that sent nothing entered nothing.
    price_b: "50", qty_b: "1",
    reference: 'PO-7 (this run already entered it in textbox "Reference" in record Invoice draft)',
    __none__: "None of the provided values belongs in this selected field; do not guess.",
  });
  assert.match(seen.question.instructions, /table_row says which row of its table the field is in/);
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
