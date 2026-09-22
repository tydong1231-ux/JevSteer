import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticPage } from "../src/semantic-snapshot.mjs";

test("semantic snapshot enriches Kapture element metadata", () => {
  const page = buildSemanticPage({
    tab: { url: "https://example.test", title: "Example", domSize: 100 },
    domHtml: `<html><body><label for="email">Email address</label><input id="email" placeholder="you@example.com"><button id="save">Save</button></body></html>`,
    rawElements: [
      { visible: true, selector: "#email", tagName: "input", id: "email", bounds: {} },
      { visible: true, selector: "#save", tagName: "button", id: "save", bounds: {} },
    ],
  });
  assert.equal(page.elements[0].label, "you@example.com");
  assert.equal(page.elements[1].label, "Save");
  assert.equal(page.elements[1].role, "button");
});

test("semantic snapshot redacts password value", () => {
  const page = buildSemanticPage({
    tab: { url: "https://example.test", title: "Login" },
    domHtml: `<html><body><input id="password" type="password" value="secret"></body></html>`,
    rawElements: [{ visible: true, selector: "#password", tagName: "input", value: "secret", bounds: {} }],
  });
  assert.equal(page.elements[0].value, "[REDACTED]");
});