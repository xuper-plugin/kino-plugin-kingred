// home() and search() (src/plugin.js): the Kino-facing catalog, built on the src/api.js client.
// kino.fetch is mocked with the real KinoResponse shape and routed by URL substring (/movies vs
// /series) to the captured catalog fixtures, so the contract runs without touching the network.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { home, search } from "../src/plugin.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const REF = /^[mt]:/;
const ID = /^[A-Za-z0-9._~-]{1,128}$/;

/** A real KinoResponse: synchronous `.json()`/`.text()`, an `ok`/`status` the client checks. */
function kinoResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, url: "", headers: {}, json: () => body, text: () => JSON.stringify(body) };
}

/** Installs a kino.fetch mock whose `handler(url)` returns the KinoResponse to answer with. */
function installFetch(handler) {
  globalThis.kino = { fetch: async (url) => handler(url) };
}

afterEach(() => {
  delete globalThis.kino;
});

test("home() returns non-empty, KinoRow-shaped rows whose items are non-empty", async () => {
  const movies = fixture("catalog-movies.json");
  const series = fixture("catalog-series.json");
  installFetch((url) => kinoResponse(url.includes("/series") ? series : movies));

  const rows = await home();

  assert.ok(Array.isArray(rows) && rows.length > 0, "home() must return a non-empty array of rows");
  for (const row of rows) {
    assert.equal(typeof row.id, "string", "row.id is a string");
    assert.match(row.id, ID, `row id "${row.id}" matches the item-id pattern (a stable slug)`);
    assert.equal(typeof row.title, "string");
    assert.ok(row.title.length > 0, "row.title is non-empty");
    assert.ok(Array.isArray(row.items) && row.items.length > 0, `row "${row.id}" has non-empty items`);
    assert.match(row.ref, /^kr:(movies|series):/, "every row carries its list's ref (browse: Ver más)");
    for (const item of row.items) {
      assert.match(item.ref, REF, `item ref "${item.ref}" starts with m: or t:`);
    }
  }
  // The rows come in the design order, movies first.
  assert.equal(rows[0].id, "movies-popular");
  assert.ok(rows.some((r) => r.id === "series-popular"), "series rows are present too");
});

test("home() drops a row that errors or comes back empty", async () => {
  const movies = fixture("catalog-movies.json");
  const series = fixture("catalog-series.json");
  installFetch((url) => {
    if (url.includes("category=terror")) return kinoResponse({ ...movies, movies: [] }); // empty row
    if (url.includes("category=anime")) return kinoResponse({}, { ok: false, status: 500 }); // failing row
    return kinoResponse(url.includes("/series") ? series : movies);
  });

  const rows = await home();
  const ids = rows.map((r) => r.id);

  assert.ok(!ids.includes("movies-terror"), "the empty 'Terror' row is dropped");
  assert.ok(!ids.includes("series-anime"), "the failing 'Anime' row is dropped");
  assert.ok(ids.includes("movies-popular"), "healthy rows survive");
  assert.ok(rows.length > 0, "the rest of Home still shows");
});

test("search({query}) returns a combined KinoItem[] with m:/t: refs, movies first", async () => {
  const moviesHits = fixture("search-movies-batman.json");
  const seriesHits = fixture("catalog-series.json");
  installFetch((url) => kinoResponse(url.includes("/series") ? seriesHits : moviesHits));

  const items = await search({ query: "batman" });

  assert.ok(Array.isArray(items) && items.length > 0, "search returns a non-empty KinoItem[]");
  for (const item of items) {
    assert.match(item.ref, REF, `item ref "${item.ref}" starts with m: or t:`);
  }
  assert.ok(items.some((i) => i.ref.startsWith("m:")), "includes a movie hit");
  assert.ok(items.some((i) => i.ref.startsWith("t:")), "includes a series hit");
  // Movies come before series.
  const firstSeries = items.findIndex((i) => i.ref.startsWith("t:"));
  const lastMovie = items.map((i) => i.ref.startsWith("m:")).lastIndexOf(true);
  assert.ok(lastMovie < firstSeries, "every movie hit precedes the series hits");
});

test("search still returns the other kind's hits when one kind fails", async () => {
  const seriesHits = fixture("catalog-series.json");
  installFetch((url) => {
    if (url.includes("/movies")) return kinoResponse({}, { ok: false, status: 500 });
    return kinoResponse(seriesHits);
  });

  const items = await search({ query: "batman" });

  assert.ok(items.length > 0, "the surviving kind is returned");
  assert.ok(items.every((i) => i.ref.startsWith("t:")), "only the series hits remain");
});

test("search returns [] for an empty query", async () => {
  installFetch(() => kinoResponse({}));
  assert.deepEqual(await search({ query: "" }), []);
  assert.deepEqual(await search({ query: "   " }), []);
  assert.deepEqual(await search({}), []);
});
