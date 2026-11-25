// The KingRed Firebase client (src/firebase.js): anonymous auth + Storage download. Firebase has no
// account here -- idToken() signs up anonymously, caches the token in kino.storage and reuses it while
// it is valid; storageJson() downloads a per-title stream JSON with the token, renewing once on 401/403.
// kino is mocked with an in-memory storage and a programmable fetch that records every call so the tests
// can assert the request count, the encoded URL and the Authorization header.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { idToken, storageJson } from "../src/firebase.js";

const SIGNUP_HOST = "identitytoolkit.googleapis.com";
const STORAGE_HOST = "firebasestorage.googleapis.com";
const TOKEN_KEY = "kingred:fbToken";

/** A KinoResponse-shaped object (synchronous json()/text(), .ok/.status), like src/api.js's mock. */
function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    headers: {},
    json: () => body,
    text: () => JSON.stringify(body),
    base64: () => "",
  };
}

/**
 * Installs globalThis.kino with an in-memory storage and a fetch that records { url, options } and
 * answers via `responder(url, options)`. Returns the backing store and the recorded calls.
 */
function installKino(responder) {
  const store = new Map();
  const calls = [];
  globalThis.kino = {
    storage: {
      get: (k) => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { store.set(k, v); },
      remove: (k) => { store.delete(k); },
      keys: () => [...store.keys()],
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return responder(url, options);
    },
  };
  return { store, calls };
}

afterEach(() => { delete globalThis.kino; });

test("idToken() signs up once and caches { token, exp }", async () => {
  const { store, calls } = installKino((url) => {
    if (url.includes(SIGNUP_HOST)) return response(200, { idToken: "tok-1", expiresIn: "3600" });
    throw new Error("unexpected fetch: " + url);
  });

  const before = Date.now();
  const token = await idToken();
  const after = Date.now();

  assert.equal(token, "tok-1");
  assert.equal(calls.length, 1, "exactly one signUp");

  const call = calls[0];
  assert.ok(call.url.includes(SIGNUP_HOST), "calls identitytoolkit");
  assert.ok(call.url.includes("accounts:signUp"), "the anonymous signUp endpoint");
  assert.ok(call.url.includes("key="), "passes the API key as ?key=");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers["Content-Type"], "application/json");
  assert.ok(String(call.options.body).includes("returnSecureToken"), "asks for a secure token");

  const saved = JSON.parse(store.get(TOKEN_KEY));
  assert.equal(saved.token, "tok-1");
  // exp = Date.now() + Number(expiresIn) * 1000, within the window the call spanned.
  assert.ok(saved.exp >= before + 3600 * 1000, "exp is at least now+expiresIn");
  assert.ok(saved.exp <= after + 3600 * 1000, "exp is at most now+expiresIn");
});

test("idToken() reuses a valid cached token without a network call", async () => {
  const { calls } = installKino((url) => {
    if (url.includes(SIGNUP_HOST)) return response(200, { idToken: "tok-1", expiresIn: "3600" });
    throw new Error("unexpected fetch: " + url);
  });

  const first = await idToken();
  assert.equal(calls.length, 1, "first call signs up");

  const second = await idToken();
  assert.equal(second, first, "returns the same token");
  assert.equal(calls.length, 1, "no second signUp while the cached token is valid");
});

test("storageJson() renews the token on 403 and retries, returning the parsed JSON", async () => {
  let signUps = 0;
  let storageGets = 0;
  const payload = { streams: [{ server: "sw", url: "https://e.example/f.m3u8" }] };

  const { calls } = installKino((url) => {
    if (url.includes(SIGNUP_HOST)) {
      signUps += 1;
      return response(200, { idToken: "tok-" + signUps, expiresIn: "3600" });
    }
    if (url.includes(STORAGE_HOST)) {
      storageGets += 1;
      if (storageGets === 1) return response(403, { error: { message: "PERMISSION_DENIED" } });
      return response(200, payload);
    }
    throw new Error("unexpected fetch: " + url);
  });

  const result = await storageJson("SourcesM/1263337.json");

  assert.deepEqual(result, payload, "returns the parsed stream JSON");
  assert.equal(signUps, 2, "the 403 forced one token renewal (a second signUp)");
  assert.equal(storageGets, 2, "the storage request was retried exactly once");

  const storageCalls = calls.filter((c) => c.url.includes(STORAGE_HOST));
  assert.equal(storageCalls.length, 2);
  // The path is percent-encoded: the slash becomes %2F.
  assert.ok(
    storageCalls[0].url.includes("/o/SourcesM%2F1263337.json?alt=media"),
    "encodes the storage path (SourcesM%2F...): " + storageCalls[0].url,
  );
  // The first attempt carried the first token; the retry carried the renewed one.
  assert.equal(storageCalls[0].options.headers.Authorization, "Firebase tok-1");
  assert.equal(storageCalls[1].options.headers.Authorization, "Firebase tok-2");
});
