// Ajustes ▸ KingRed (src/plugin.js): the settings-form exports Kino calls on the plugin's own
// settings page. settingsStatus() is the "Estado" status line; action(key) runs an action button.
// kino.storage is mocked in-memory with the Firebase token key present, so the clearCache action can
// be seen to drop ONLY that KingRed-owned key (std's own storage is never touched).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { settingsStatus, action } from "../src/plugin.js";
import { TOKEN_KEY } from "../src/firebase.js";

/** Installs globalThis.kino with an in-memory storage seeded with the entries in `seed`. */
function installKino(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.kino = {
    storage: {
      get: (k) => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { store.set(k, v); },
      remove: (k) => { store.delete(k); },
      keys: () => [...store.keys()],
    },
  };
  return store;
}

afterEach(() => { delete globalThis.kino; });

test("settingsStatus() returns a non-empty {info} status line of at most 200 chars", async () => {
  installKino();
  const out = await settingsStatus();
  assert.equal(typeof out, "object");
  assert.equal(typeof out.info, "string");
  assert.ok(out.info.length > 0, "the status line is non-empty");
  assert.ok(out.info.length <= 200, `the status line is at most 200 chars (got ${out.info.length})`);
});

test('action("clearCache") removes the Firebase token key and returns a non-empty {message}', async () => {
  const store = installKino({ [TOKEN_KEY]: JSON.stringify({ token: "x", exp: Date.now() + 1e9 }) });
  assert.ok(store.has(TOKEN_KEY), "precondition: the token key is present");

  const out = await action("clearCache");

  assert.equal(store.has(TOKEN_KEY), false, "the Firebase token key is gone after clearCache");
  assert.equal(typeof out.message, "string");
  assert.ok(out.message.length > 0, "clearCache returns a non-empty message");
});

test('action("clearCache") leaves std-owned storage keys untouched', async () => {
  const store = installKino({ [TOKEN_KEY]: "t", "std:home": "cached", "c:foo": "bar" });
  await action("clearCache");
  assert.equal(store.has(TOKEN_KEY), false, "the KingRed token key is cleared");
  assert.equal(store.has("std:home"), true, "a std storage key is left alone");
  assert.equal(store.has("c:foo"), true, "any non-KingRed key is left alone");
});

test('action() with an unknown key returns {message:""} without throwing', async () => {
  installKino({ [TOKEN_KEY]: "t" });
  const out = await action("nope");
  assert.deepEqual(out, { message: "" });
});
