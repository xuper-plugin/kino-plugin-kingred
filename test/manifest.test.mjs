// The KingRed manifest: the fields Kino and the other tasks rely on. Reads kino-plugin.json straight
// from disk (not the bundle) so it fails loudly if a required field is missing or wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "kino-plugin.json"), "utf8"));

test("identity", () => {
  assert.equal(manifest.id, "kingred");
  assert.equal(manifest.entry, "plugin.js");
});

test("apiVersion is at least 20 (the plugin protocol / resolver door)", () => {
  assert.ok(Number.isInteger(manifest.apiVersion), "apiVersion must be an integer");
  assert.ok(manifest.apiVersion >= 20, `apiVersion ${manifest.apiVersion} < 20`);
});

test("apiVersion is at least 30 (the standard screen and the catalog door)", () => {
  assert.ok(manifest.apiVersion >= 30, `apiVersion ${manifest.apiVersion} < 30`);
});

test("capabilities are exactly browse, episodes, home, resolve, screen, search", () => {
  assert.ok(Array.isArray(manifest.capabilities));
  assert.deepEqual([...manifest.capabilities].sort(), ["browse", "episodes", "home", "resolve", "screen", "search"]);
  assert.equal(manifest.streamHosts, "any");
});

test("consumes the resolver door: resolve + normalizeHost, and no rank", () => {
  const r = manifest.consumes?.resolver;
  assert.ok(r, "consumes.resolver missing");
  assert.equal(r.repo, "xuper-plugin/kino-plugin-kino-resolver");
  assert.equal(r.door, "resolver");
  assert.ok(Array.isArray(r.calls));
  assert.ok(r.calls.includes("resolve"), "resolver must be called for resolve");
  // The install-gate probe (resolverInstalled) calls normalizeHost on the door; Kino checks the
  // DECLARED call list before provider existence, so an undeclared probe would throw not_declared
  // (never provider_missing) and the gate could never fire. It must be declared for per-door consent.
  assert.ok(r.calls.includes("normalizeHost"), "the install probe calls normalizeHost: it must be declared");
  assert.ok(!r.calls.includes("rank"), '"rank" is not a real door call');
});

test("browser is enabled (captures gate hosts the door returns as needs_browser)", () => {
  assert.equal(manifest.browser, true);
});

test("recommends the resolver plugin", () => {
  assert.ok(Array.isArray(manifest.recommends));
  assert.ok(
    manifest.recommends.includes("xuper-plugin/kino-plugin-kino-resolver"),
    "recommends must list the resolver",
  );
});

test("hosts include the KingRed catalog, Firebase auth and storage", () => {
  assert.ok(Array.isArray(manifest.hosts));
  for (const host of [
    "st.kinghydra.site",
    "firebasestorage.googleapis.com",
    "identitytoolkit.googleapis.com",
  ]) {
    assert.ok(manifest.hosts.includes(host), `missing host "${host}"`);
  }
});

test("settings form: audio select (lat/cast/sub, default lat), info status, clearCache action", () => {
  assert.ok(Array.isArray(manifest.settings), "settings must be an array");
  const byKey = (key) => manifest.settings.find((s) => s && s.key === key);

  const audio = byKey("audio");
  assert.ok(audio, "a select keyed 'audio' is present");
  assert.equal(audio.type, "select");
  assert.equal(audio.default, "lat", "the preferred language defaults to Latino");
  assert.deepEqual(
    audio.options.map((o) => o.value),
    ["lat", "cast", "sub"],
    "the audio options are exactly lat, cast, sub",
  );

  const info = byKey("info");
  assert.ok(info, "a status keyed 'info' is present");
  assert.equal(info.type, "status");

  const clearCache = byKey("clearCache");
  assert.ok(clearCache, "an action keyed 'clearCache' is present");
  assert.equal(clearCache.type, "action");
});

test("screen block opens from the menu and settings, with a settingsButton", () => {
  const s = manifest.screen;
  assert.ok(s, "a screen block is present");
  assert.deepEqual([...s.opensFrom].sort(), ["menu", "settings"]);
  assert.ok(s.settingsButton, "the screen declares a settingsButton");
  assert.equal(typeof s.settingsButton.label, "string");
  assert.equal(s.settingsIn, "both");
});
