import test from "node:test";
import assert from "node:assert/strict";
import { createProjectSession } from "../../web/src/project-session.ts";

const snapshot = id => ({ context: { projectId: id, entries: [], artifacts: [], changes: [] }, runs: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(id, load, updates = [], errors = []) {
  const stream = { onopen: null, onmessage: null, onerror: null, closed: false, close() { this.closed = true; } };
  const session = createProjectSession(id, { load, connect: () => stream, onUpdate: value => updates.push(value), onError: value => errors.push(value), onConnected: () => {} });
  return { stream, session, updates, errors };
}

test("switching projects cancels previous requests and ignores late snapshots and queued stream events", async () => {
  const oldResponse = deferred();
  let oldSignal;
  const updates = [], errors = [];
  const old = setup("A", (_id, signal) => { oldSignal = signal; return oldResponse.promise; }, updates, errors);
  const queuedMessage = old.stream.onmessage;
  old.session.dispose();
  const current = setup("B", async () => snapshot("B"), updates, errors);
  await tick();
  oldResponse.resolve(snapshot("A"));
  queuedMessage();
  await old.session.refresh();
  await tick();
  assert.equal(oldSignal.aborted, true);
  assert.equal(old.stream.closed, true);
  assert.equal(old.stream.onmessage, null);
  assert.deepEqual(updates.map(value => value.context.projectId), ["B"]);
  assert.deepEqual(errors, []);
  current.session.dispose();
});

test("project responses must match the active project and stale errors cannot replace current state", async () => {
  const invalid = setup("B", async () => snapshot("A"));
  await tick();
  assert.deepEqual(invalid.updates, []);
  assert.match(invalid.errors[0], /does not match/);
  invalid.session.dispose();
  const response = deferred();
  const stale = setup("A", () => response.promise);
  stale.session.dispose();
  response.reject(new Error("Old project failed"));
  await tick();
  assert.deepEqual(stale.errors, []);
});

test("rapid A to B to A switching isolates each session, including repeated project IDs", async () => {
  const first = deferred(), second = deferred(), third = deferred();
  const updates = [];
  const a = setup("A", () => first.promise, updates);
  a.session.dispose();
  const b = setup("B", () => second.promise, updates);
  b.session.dispose();
  const latest = setup("A", () => third.promise, updates);
  third.resolve({ ...snapshot("A"), marker: "latest" }); await tick();
  second.resolve(snapshot("B")); first.resolve(snapshot("A")); await tick();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].marker, "latest");
  latest.session.dispose();
});

test("live refreshes coalesce without allowing the previous lifetime to schedule more requests", async () => {
  const response = deferred();
  let calls = 0;
  const current = setup("A", () => { calls++; return calls === 1 ? response.promise : Promise.resolve(snapshot("A")); });
  current.stream.onmessage(); current.stream.onmessage();
  assert.equal(calls, 1);
  response.resolve(snapshot("A")); await tick();
  assert.equal(calls, 2);
  current.session.dispose();
  await current.session.refresh();
  assert.equal(calls, 2);
});
