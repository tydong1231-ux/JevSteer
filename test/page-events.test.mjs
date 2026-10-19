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
  events.close();
  assert.deepEqual(events.requests(0), { started: 0, pending: 0 });
});

test("a slow report is waited on until it returns, and a long poll once the page sends it again on its own", () => {
  let clock = 1_000_000;
  const page = new EventEmitter();
  const events = new PageEvents(page, { now: () => clock });
  const get = (path) => ({ resourceType: () => "fetch", method: () => "GET", url: () => `https://app.test${path}` });
  // A report that takes 12 s is still waited on after 8 s.
  events.input(clock);
  let since = clock;
  const report = get("/api/report?period=2025");
  page.emit("request", report);
  clock += 12000;
  assert.deepEqual(events.requests(since), { started: 1, pending: 1 });
  page.emit("requestfinished", report);
  // The next Generate sends it again right after it returned. That request
  // belongs to the input and is waited on too.
  clock += 600;
  events.input(clock);
  since = clock;
  const again = get("/api/report?period=2026");
  page.emit("request", again);
  clock += 9000;
  assert.deepEqual(events.requests(since), { started: 1, pending: 1 });
  // One still open after 30 s is a stream or will not return.
  clock += 21000;
  assert.deepEqual(events.requests(since), { started: 1, pending: 0 });
  page.emit("requestfinished", again);
  // A long poll is held open until the server has news, and the page sends it
  // again at once with no input in between. From then on its requests are
  // neither waited on nor counted; the input's own requests still are.
  clock += 5000;
  const poll = get("/api/updates?cursor=1");
  page.emit("request", poll);
  clock += 25000;
  assert.equal(events.requests(since).pending, 1);
  page.emit("requestfinished", poll);
  clock += 20;
  page.emit("request", get("/api/updates?cursor=2"));
  assert.equal(events.requests(since).pending, 0);
  clock += 3000;
  events.input(clock);
  since = clock;
  page.emit("request", get("/api/updates?cursor=3"));
  page.emit("request", get("/api/report?period=2027"));
  assert.deepEqual(events.requests(since), { started: 1, pending: 1 });
  events.close();
});

test("analytics and ad beacons are not counted as the page's data requests", () => {
  const page = new EventEmitter();
  const events = new PageEvents(page);
  const since = Date.now();
  for (const url of ["https://www.google.com/rmkt/collect/1/?en=form_start", "https://api2.amplitude.com/2/httpapi", "https://region1.google-analytics.com/g/collect?v=2"]) {
    page.emit("request", { resourceType: () => "fetch", method: () => "POST", url: () => url });
  }
  assert.deepEqual(events.requests(since), { started: 0, pending: 0 });
  page.emit("request", request("xhr"));
  assert.deepEqual(events.requests(since), { started: 1, pending: 1 });
  events.close();
});
