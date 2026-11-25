// The KingRed screen is the vendored std kit (src/std) wired in src/plugin.js: screen()/screenEvent()
// delegate to a lazy makeStandardScreen({ needsResolver: true, tabs: TABS, loadTab }). The kit paints
// its own resolver install-gate while kino-resolver is missing (needsResolver) and the full browse
// Scaffold once it is installed. Kino reports the resolver's state in ctx.installed[<repo>].
//
// The std kit reads kino.storage and (on a tab load) kino.fetch/kino.config, so this file mocks a
// sufficient globalThis.kino (in-memory storage + a fetch/config/log stub) the way cinehdplus's
// test/std.test.mjs mocks fakeKino. screen() here never loads a tab (no tick), so the stubs only need
// to exist; the gate and the first browse paint are drawn from what is kept (nothing), with no network.
import { test } from "node:test";
import assert from "node:assert/strict";

const RESOLVER_REPO = "xuper-plugin/kino-plugin-kino-resolver";

// A sufficient kino for the std kit: in-memory storage (get/set/keys/remove), a fetch stub that never
// has to answer here, config.get returning the default, and a noop log. Set before importing plugin.js
// so the lazy makeStandardScreen singleton captures it on the first screen() call.
function fakeKino() {
  const m = new Map();
  return {
    storage: {
      get: (k) => (m.has(k) ? m.get(k) : null),
      set: (k, v) => m.set(k, v),
      keys: () => [...m.keys()],
      remove: (k) => m.delete(k),
    },
    fetch: async () => ({ ok: true, status: 200, json: () => ({}), text: async () => "{}" }),
    config: { get: (_k, d) => d },
    log() {},
  };
}

globalThis.kino = fakeKino();

const { screen, screenEvent } = await import("../src/plugin.js");

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

test("screen() shows the kit's resolver install gate when the resolver is not installed", async () => {
  const tree = await screen({ installed: { [RESOLVER_REPO]: false } });

  const button = findByKey(tree, "installResolver");
  assert.ok(button, "the kit's gate has an install button keyed 'installResolver'");
  assert.equal(
    button.onPressed?.go?.installPlugin?.repo,
    RESOLVER_REPO,
    "its go installs the resolver repo (the kit's install gate: needsResolver + not installed)",
  );
});

test("screen() shows the std browse Scaffold (no install gate) once the resolver is installed", async () => {
  const tree = await screen({ installed: { [RESOLVER_REPO]: true } });

  assert.equal(tree.type, "Scaffold", "the std kit returns a Scaffold-type screen tree");
  assert.equal(findByKey(tree, "installResolver"), null, "no install gate when the resolver is installed");
  // The std bar carries the search and settings actions: proof it is the kit's screen, not a bare gate.
  assert.deepEqual(
    tree.appBar.actions.map((a) => a.icon),
    ["search", "settings"],
    "the standard bar's search + settings actions",
  );
});

test("screenEvent() resolves without throwing", async () => {
  assert.equal(await screenEvent({}), null);
});
