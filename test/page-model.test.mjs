import test from "node:test";
import assert from "node:assert/strict";
import { repeatsBlock, elementFingerprint, toModelPage } from "../src/page-model.mjs";

test("repeatsBlock detects repeated cycles", () => {
  assert.equal(repeatsBlock(["a", "b", "a", "b", "a", "b"], 2, 3), true);
  assert.equal(repeatsBlock(["a", "b", "a", "c", "a", "b"], 2, 3), false);
});

test("element fingerprint is stable for semantic identity", () => {
  const a = { tag: "button", role: "button", label: "Save", near: "Invoice" };
  const b = { ...a, selector: "#changed" };
  assert.equal(elementFingerprint(a), elementFingerprint(b));
});

test("password values are redacted from model page", () => {
  const page = {
    url: "https://example.test",
    title: "Login",
    text: "Login",
    metrics: {},
    elements: [{ i: 0, tag: "input", role: "textbox", label: "Password", type: "password", value: "hunter2" }],
  };
  assert.equal(toModelPage(page).elements[0].value, "[REDACTED]");
});