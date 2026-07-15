import assert from "node:assert/strict";
import test from "node:test";
import { moveListSelection } from "../../src/ui-catalog/list-state.ts";

test("wheel/list navigation clamps like a keyboard list", () => {
  assert.equal(moveListSelection(0, -1, 3), 0);
  assert.equal(moveListSelection(0, 1, 3), 1);
  assert.equal(moveListSelection(2, 1, 3), 2);
  assert.equal(moveListSelection(4, -1, 0), 0);
});
