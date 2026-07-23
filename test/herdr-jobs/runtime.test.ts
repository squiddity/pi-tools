import assert from "node:assert/strict";
import test from "node:test";
import { getRuntime, withDeliveryLock, type HerdrJobsRuntime } from "../../src/herdr-jobs/runtime.ts";

test("runtime adoption initializes delivery locks added after an older reload", () => {
  const key = Symbol.for("pi-tools/herdr-jobs/runtime");
  const holder = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const previous = holder[key];
  try {
    holder[key] = { jobs: new Map() };
    const runtime = getRuntime();
    assert.ok(runtime.deliveryLocks instanceof Map);
    assert.equal(runtime.widgetMounted, false);
  } finally {
    if (previous === undefined) delete holder[key];
    else holder[key] = previous;
  }
});

test("runtime adoption stops watchers from the removed agent feature", () => {
  const key = Symbol.for("pi-tools/herdr-jobs/runtime");
  const holder = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const previous = holder[key];
  const controller = new AbortController();
  const legacyAgents = new Map([["old", { abortController: controller }]]);
  try {
    holder[key] = { jobs: new Map(), deliveryLocks: new Map(), managedAgents: legacyAgents };
    getRuntime();
    assert.equal(controller.signal.aborted, true);
    assert.equal(legacyAgents.size, 0);
    assert.equal(Object.hasOwn(holder[key] as object, "managedAgents"), false);
  } finally {
    if (previous === undefined) delete holder[key];
    else holder[key] = previous;
  }
});

test("delivery locks serialize duplicate event delivery", async () => {
  const runtime = { jobs: new Map(), deliveryLocks: new Map() } as HerdrJobsRuntime;
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const first = withDeliveryLock(runtime, "job:result", async () => {
    order.push("first-start");
    await gate;
    order.push("first-end");
  });
  const second = withDeliveryLock(runtime, "job:result", async () => {
    order.push("second");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
  assert.equal(runtime.deliveryLocks.size, 0);
});
