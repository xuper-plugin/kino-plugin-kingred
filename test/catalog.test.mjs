// The standard-plugin side of KingRed: the catalog door (proto_catalog_search / proto_catalog_episodes) that Da-Video asks,
// the typed Home rows with their "Ver más" refs, browse() of every ref, the category tiles with art, and the ES + EN words.
// kino.fetch is mocked: catalog requests answer the real fixtures (page/total_pages taken from the URL), Firebase answers
// a token and the real SourcesT.json.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { home, browse, categories, search, episodes, proto_catalog_search, proto_catalog_episodes } from "../src/plugin.js";
import { loadTab, TABS } from "../src/tabs.js";
import { parseListRef, listRef } from "../src/lists.js";
import { KEYS } from "../src/i18n.js";
import { CATALOG_PROVIDES } from "../src/std/catalog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test", "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "kino-plugin.json"), "utf8"));

const TOTAL_PAGES = 3;

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, url: "", headers: {}, json: () => body, text: () => JSON.stringify(body) };
}

/** Installs a kino whose catalog answers the fixtures (TOTAL_PAGES pages) and whose Firebase serves SourcesT.json. */
function installKino({ lang = "es" } = {}) {
  const urls = [];
  const store = new Map();
  globalThis.kino = {
    lang,
    storage: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v), remove: (k) => store.delete(k), keys: () => [...store.keys()] },
    error: (code, message, opts) => Object.assign(new Error(message), { code }, opts || {}),
    fetch: async (url) => {
      urls.push(url);
      if (url.includes("identitytoolkit.googleapis.com")) return response(200, { idToken: "tok", expiresIn: "3600" });
      if (url.includes("firebasestorage.googleapis.com")) return response(200, fixture("SourcesT.json"));
      const u = new URL(url);
      const kind = u.pathname.endsWith("/movies") ? "movies" : "series";
      const body = { ...fixture(kind === "movies" ? "catalog-movies.json" : "catalog-series.json") };
      body.page = Number(u.searchParams.get("page"));
      body.total_pages = TOTAL_PAGES;
      return response(200, body);
    },
  };
  return urls;
}

afterEach(() => { delete globalThis.kino; });

test("the manifest provides std's catalog door", () => {
  assert.deepEqual(manifest.provides, CATALOG_PROVIDES);
});

test("search() items carry ids.tmdb, and the door's search answers them with tmdb", async () => {
  installKino();
  const found = await search({ q: "batman" });
  assert.ok(found.length > 0);
  for (const it of found) assert.ok(Number.isInteger(it.ids.tmdb) && it.ids.tmdb > 0, "ids.tmdb on " + it.ref);

  const door = await proto_catalog_search({ q: "batman" });
  assert.ok(door.length > 0 && door.length <= 40);
  for (const it of door) {
    assert.ok(Number.isInteger(it.tmdb) && it.tmdb > 0, "tmdb on " + it.ref);
    assert.ok(/^[mt]:\d+$/.test(it.ref));
    assert.ok(it.kind === "movie" || it.kind === "series");
  }
  assert.deepEqual(await proto_catalog_search({ q: "  " }), []);
});

test("the door's search of one kind asks only that half of the catalog", async () => {
  const urls = installKino();
  const got = await proto_catalog_search({ q: "batman", type: "series" });
  assert.ok(urls.every((u) => u.includes("/series?")), "only series asked");
  assert.ok(got.every((it) => it.kind === "series"));
});

test("the door's episodes answers season/number/ref rows of a series", async () => {
  installKino();
  const own = await episodes("t:1396");
  const rows = await proto_catalog_episodes({ ref: "t:1396" });
  assert.equal(rows.length, own.episodes.length);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(Number.isInteger(r.season) && Number.isInteger(r.number) && r.number >= 1);
    assert.equal(r.ref, `t:1396:${r.season}:${r.number}`);
    assert.equal(r.title, `Capítulo ${r.number}`);
  }
  assert.deepEqual(await proto_catalog_episodes({ ref: "" }), []);
});

test("episode titles follow Kino's language", async () => {
  installKino({ lang: "en" });
  const { episodes: list } = await episodes("t:1396");
  assert.equal(list[0].title, `Episode ${list[0].number}`);
});

test("every Home row is typed (genre) and carries a browsable ref", async () => {
  installKino();
  const rows = await home();
  assert.equal(rows.length, 10);
  const allowed = new Set(["peliculas", "series", "anime", "infantil"]);
  for (const row of rows) {
    assert.ok(allowed.has(row.genre), `${row.id} genre ${row.genre}`);
    assert.ok(parseListRef(row.ref), `${row.id} ref ${row.ref}`);
    assert.equal(row.genre === "peliculas", row.ref.startsWith("kr:movies:"), `${row.id}: movie rows are peliculas`);
  }
  assert.equal(rows.find((r) => r.id === "series-anime").genre, "anime");
  assert.equal(rows.find((r) => r.id === "movies-popular").title, "Películas populares");
});

test("Home row titles follow Kino's language", async () => {
  installKino({ lang: "en" });
  const rows = await home();
  assert.equal(rows.find((r) => r.id === "movies-popular").title, "Popular movies");
  assert.equal(rows.find((r) => r.id === "movies-terror").title, "Horror");
});

test("browse() pages every Home ref: page 1, a next cursor, and no next on the last page", async () => {
  installKino();
  for (const row of await home()) {
    const first = await browse(row.ref, null);
    assert.ok(first.items.length > 0, row.ref);
    assert.equal(first.next, "2", row.ref);
    for (const it of first.items) assert.ok(it.ids && it.ids.tmdb > 0);
    const last = await browse(row.ref, String(TOTAL_PAGES));
    assert.equal(last.next, undefined, row.ref);
  }
});

test("browse() asks the site for the ref's list and page", async () => {
  const urls = installKino();
  await browse("kr:series:recent:anime", "2");
  const u = new URL(urls[0]);
  assert.ok(u.pathname.endsWith("/series"));
  assert.equal(u.searchParams.get("page"), "2");
  assert.equal(u.searchParams.get("sort"), "recent");
  assert.equal(u.searchParams.get("category"), "anime");
});

test("browse() refuses a ref that is not a list", async () => {
  installKino();
  for (const bad of ["", "m:1", "kr:books::", "kr:movies:nope:", "kr:movies::nope"]) {
    await assert.rejects(browse(bad, null), (e) => e.code === "not_found", bad);
  }
});

test("every tab row of the std screen carries a ref (its rail shows Ver más) and both titles", async () => {
  installKino();
  for (const tab of TABS) {
    const { rows } = await loadTab(tab.id);
    assert.ok(rows.length > 0, tab.id);
    for (const row of rows) {
      assert.ok(parseListRef(row.ref), `${row.id} ref`);
      assert.equal(typeof row.titleEn, "string");
      const page = await browse(row.ref, null);
      assert.ok(page.items.length > 0);
    }
  }
});

test("categories() are at most 24 tiles with https TMDB art, each opening a browsable list", async () => {
  installKino();
  const tiles = await categories();
  assert.ok(tiles.length > 0 && tiles.length <= 24);
  const ids = new Set();
  for (const tile of tiles) {
    assert.ok(!ids.has(tile.id), "unique id " + tile.id);
    ids.add(tile.id);
    assert.ok(tile.title && tile.title.length <= 40);
    assert.ok(/^https:\/\/image\.tmdb\.org\/t\/p\/w780\/\w+\.jpg$/.test(tile.art), tile.art);
    assert.ok(parseListRef(tile.ref), tile.ref);
    assert.ok((await browse(tile.ref, null)).items.length > 0);
  }
  installKino({ lang: "en" });
  assert.equal((await categories()).find((x) => x.id === "terror-movies").title, "Horror");
});

test("listRef and parseListRef round-trip", () => {
  const p = { kind: "movies", sort: "rating", category: "drama" };
  assert.deepEqual(parseListRef(listRef(p)), p);
  assert.deepEqual(parseListRef(listRef({ kind: "series", category: "anime" })), { kind: "series", category: "anime" });
});

test("both languages hold the same words", () => {
  assert.deepEqual([...KEYS.en].sort(), [...KEYS.es].sort());
});
