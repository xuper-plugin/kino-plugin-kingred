import test from "node:test";
import assert from "node:assert/strict";

import { LOGO, LOGO_ASPECT } from "../src/logo.js";
import { makeStandardScreen } from "../src/std/index.js";

test("LOGO is a base64 PNG data address", () => {
  assert.ok(LOGO.startsWith("data:image/png;base64,"));
  assert.ok(LOGO.length > 1000);
});

test("LOGO_ASPECT is the square icon ratio", () => {
  assert.equal(LOGO_ASPECT, "1:1");
});

test("std kit exports makeStandardScreen", () => {
  assert.equal(typeof makeStandardScreen, "function");
});
