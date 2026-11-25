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

test("capabilities include search, home, resolve and episodes", () => {
  assert.ok(Array.isArray(manifest.capabilities));
  for (const cap of ["search", "home", "resolve", "episodes"]) {
    assert.ok(manifest.capabilities.includes(cap), `missing capability "${cap}"`);
  }
});

test("consumes the resolver door, resolve only (no rank)", () => {
  const r = manifest.consumes?.resolver;
  assert.ok(r, "consumes.resolver missing");
  assert.equal(r.repo, "xuper-plugin/kino-plugin-kino-resolver");
  assert.equal(r.door, "resolver");
  assert.ok(Array.isArray(r.calls));
  assert.ok(r.calls.includes("resolve"), "resolver must be called for resolve");
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
