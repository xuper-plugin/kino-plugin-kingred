// The resolver install-gate screen (src/plugin.js screen()/screenEvent(), built on src/gate.js). Kino
// tells the plugin whether its recommended resolver is installed through `ctx.installed[<repo>]`: while
// the resolver is missing screen() must show the install gate (a button whose `go.installPlugin.repo`
// points at the resolver), and once it is installed it shows the normal "all set" screen instead.
import { test } from "node:test";
import assert from "node:assert/strict";

import { screen, screenEvent } from "../src/plugin.js";

const RESOLVER_REPO = "xuper-plugin/kino-plugin-kino-resolver";

/** Depth-first search for the first node carrying `key` anywhere in a screen tree, or null. */
function findByKey(node, key) {
  if (!node || typeof node !== "object") return null;
  if (node.key === key) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const hit = findByKey(child, key);
        if (hit) return hit;
      }
    } else if (value && typeof value === "object") {
      const hit = findByKey(value, key);
      if (hit) return hit;
    }
  }
  return null;
}

test("screen() shows the install gate when the resolver is not installed", async () => {
  const tree = await screen({ installed: { [RESOLVER_REPO]: false } });

  const button = findByKey(tree, "installResolver");
  assert.ok(button, "the gate has an install button keyed 'installResolver'");
  assert.equal(button.onPressed?.go?.installPlugin?.repo, RESOLVER_REPO, "its go installs the resolver repo");
});

test("screen() shows the install gate when `installed` has no entry for the resolver", async () => {
  const tree = await screen({ installed: {} });

  const button = findByKey(tree, "installResolver");
  assert.ok(button, "a missing `installed` entry is treated as not installed");
  assert.equal(button.onPressed?.go?.installPlugin?.repo, RESOLVER_REPO);
});

test("screen() shows the ready screen (no install button) once the resolver is installed", async () => {
  const tree = await screen({ installed: { [RESOLVER_REPO]: true } });

  assert.equal(findByKey(tree, "installResolver"), null, "no install button when the resolver is installed");
});

test("screenEvent() returns null without throwing", async () => {
  assert.equal(await screenEvent({}), null);
});
