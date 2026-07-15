import assert from "node:assert/strict";
import test from "node:test";
import { withDeliveryLock, type HerdrJobsRuntime } from "../../src/herdr-jobs/runtime.ts";

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
