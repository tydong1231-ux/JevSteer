import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PageEvents } from "../src/browser/events.mjs";

const request = (type) => ({ resourceType: () => type, method: () => "GET", url: () => "https://app.test/api/report?token=secret" });

test("page events count the data requests an input started and the ones still open", () => {
  const page = new EventEmitter();
  const events = new PageEvents(page);
  const early = request("fetch");
  page.emit("request", early);
  const since = Date.now() + 1;
  while (Date.now() < since); // the input comes a moment after that request
  const report = request("xhr");
  const image = request("image");
  page.emit("request", report);
  page.emit("request", image);
  assert.deepEqual(events.requests(since), { started: 1, pending: 1 });
  // The request sent before the input is open but not counted for it.
  assert.deepEqual(events.requests(0), { started: 2, pending: 2 });
  page.emit("requestfinished", report);
  assert.deepEqual(events.requests(since), { started: 1, pending: 0 });
  page.emit("requestfailed", early);
  assert.deepEqual(events.requests(0), { started: 2, pending: 0 });
  // A request open for longer than the limit (a long poll) is not waited on,
  // and neither is the next request to the same endpoint.
  const poll = { ...request("fetch"), url: () => "https://app.test/api/updates?cursor=1" };
  page.emit("request", poll);
  assert.equal(events.requests(since).pending, 1);
  assert.equal(events.requests(since, { now: Date.now() + 9000 }).pending, 0);
  page.emit("request", { ...poll, url: () => "https://app.test/api/updates?cursor=2" });
  page.emit("request", request("fetch"));
  assert.equal(events.requests(since).pending, 1);
  events.close();
  assert.deepEqual(events.requests(0), { started: 0, pending: 0 });
});
