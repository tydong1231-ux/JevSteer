import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticPage } from "../src/semantic-snapshot.mjs";
import { sameIdentity, actionIdentity } from "../src/element-identity.mjs";

test("plain repeated cards bind identical action labels to their own record", () => {
  const make = (added) => buildSemanticPage({tab:{url:"https://example.test/catalog"},
    domHtml:`<body><div class="catalog"><div class="item"><div><a role="button" href="#bag">Backpack</a><p>Travel bag</p></div><div><span>$29.99</span><button id="bag">${added ? "Remove" : "Add to cart"}</button></div></div><div class="item"><div><a role="button" href="#light">Bike Light</a><p>Red light</p></div><div><span>$9.99</span><button id="light">Add to cart</button></div></div></div></body>`,
    rawElements:["bag","light"].map(id=>({visible:true,selector:`#${id}`,tagName:"button"}))});
  const before=make(false), after=make(true);
  assert.match(before.elements[0].context,/Backpack/);
  assert.match(before.elements[1].context,/Bike Light/);
  assert(!before.elements[1].context.includes("Backpack"));
  assert(!sameIdentity(before.elements[0],before.elements[1],before.url));
  assert.notEqual(actionIdentity({tool:"click",el:before.elements[0]},before.url),actionIdentity({tool:"click",el:before.elements[1]},before.url));
  assert.equal(before.elements[0].context,after.elements[0].context);
});

test("card fallback does not invent a record from action-only wrappers or a whole page", () => {
  const page=buildSemanticPage({tab:{url:"https://example.test"},domHtml:'<body><main><div><button id="a">Save</button></div><div><button id="b">Save</button></div></main></body>',rawElements:["a","b"].map(id=>({visible:true,selector:`#${id}`,tagName:"button"}))});
  assert(page.elements.every(e=>!e.context));
});

test("semantic snapshot enriches Kapture element metadata", () => {
  const page = buildSemanticPage({
    tab: { url: "https://example.test", title: "Example", domSize: 100 },
    domHtml: `<html><body><label for="email">Email address</label><input id="email" placeholder="you@example.com"><button id="save">Save</button></body></html>`,
    rawElements: [
      { visible: true, selector: "#email", tagName: "input", id: "email", bounds: {} },
      { visible: true, selector: "#save", tagName: "button", id: "save", bounds: {} },
    ],
  });
  assert.equal(page.elements[0].label, "Email address");
  assert.equal(page.elements[1].label, "Save");
  assert.equal(page.elements[1].role, "button");
});

test("semantic snapshot marks a field its required attribute or aria-required marks", () => {
  const page = buildSemanticPage({
    tab: { url: "https://example.test", title: "Example" },
    domHtml: `<html><body><input id="a" aria-label="A" required><input id="b" aria-label="B" aria-required="true"><input id="c" aria-label="C" aria-required="false"></body></html>`,
    rawElements: ["a", "b", "c"].map((id) => ({ visible: true, selector: `#${id}`, tagName: "input", id, bounds: {} })),
  });
  assert.deepEqual(page.elements.map((e) => e.required), [true, true, undefined]);
});

test("semantic snapshot redacts password value", () => {
  const page = buildSemanticPage({
    tab: { url: "https://example.test", title: "Login" },
    domHtml: `<html><body><input id="password" type="password" value="secret"></body></html>`,
    rawElements: [{ visible: true, selector: "#password", tagName: "input", value: "secret", bounds: {} }],
  });
  assert.equal(page.elements[0].value, "[REDACTED]");
});
