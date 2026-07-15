import assert from "node:assert/strict";
import test from "node:test";
import { catalogTapTarget, isCatalogTapTarget } from "../../src/ui-catalog/layout.ts";

test("limits the tappable region to the caret and UI catalog label", () => {
  const target = catalogTapTarget(80, 24, false);
  assert.deepEqual(target, { left: 10, right: 21, row: 19 });
  assert.equal(isCatalogTapTarget(10, 19, 80, 24, false), true); // caret
  assert.equal(isCatalogTapTarget(21, 19, 80, 24, false), true); // final "g"
  assert.equal(isCatalogTapTarget(9, 19, 80, 24, false), false); // leading space
  assert.equal(isCatalogTapTarget(22, 19, 80, 24, false), false); // after label
  assert.equal(isCatalogTapTarget(12, 20, 80, 24, false), false); // next line
});

test("moves the target with the expanded panel height", () => {
  assert.deepEqual(catalogTapTarget(80, 24, true), { left: 10, right: 21, row: 15 });
});
