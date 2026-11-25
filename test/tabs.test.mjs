// The KingRed tab loader (src/tabs.js): TABS defines the eight category tabs and loadTab(tabId)
// builds each tab's KinoRows by calling catalogPage (src/api.js) concurrently, dropping rows that
// error or come back empty, and tagging every item with ids.tmdb from its ref. kino.fetch is mocked
// to serve the real catalog fixtures, routed by URL (/movies, /series); one sort can be forced empty
// to prove a barren row is dropped rather than shown.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TABS, loadTab } from "../src/tabs.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/**
 * Installs a kino.fetch mock that serves catalog-movies.json for /movies and catalog-series.json for
 * /series. When `emptySort` is given, any request carrying that sort answers an empty catalog, so the
 * matching row has zero items. Returns the array of seen URLs.
 */
function installFetch({ emptySort } = {}) {
  const urls = [];
  globalThis.kino = {
    fetch: async (urlStr) => {
      urls.push(urlStr);
      const u = new URL(urlStr);
      const kind = u.pathname.endsWith("/movies") ? "movies" : "series";
      let body;
      if (emptySort && u.searchParams.get("sort") === emptySort) {
        body = { page: 1, per_page: 50, total: 0, total_pages: 0, [kind]: [] };
      } else {
        body = fixture(kind === "movies" ? "catalog-movies.json" : "catalog-series.json");
      }
      return {
        ok: true,
        status: 200,
        url: urlStr,
        headers: {},
        json: () => body,
        text: () => JSON.stringify(body),
      };
    },
  };
  return urls;
}

afterEach(() => {
  delete globalThis.kino;
});

test("TABS has the eight KingRed tabs in order", () => {
  assert.deepEqual(
    TABS.map((t) => t.id),
    ["inicio", "peliculas", "series", "animes", "doramas", "accion", "terror", "comedia"],
  );
  for (const tab of TABS) {
    assert.equal(typeof tab.label, "string");
    assert.equal(typeof tab.labelEn, "string");
  }
});

test("loadTab builds non-empty rows whose items carry ids.tmdb", async () => {
  installFetch();

  const { rows } = await loadTab("peliculas");

  assert.ok(rows.length > 0, "expected at least one row");
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.equal(typeof row.title, "string");
    assert.ok(Array.isArray(row.items) && row.items.length > 0, "row must have items");
    for (const item of row.items) {
      assert.ok(Number.isInteger(item.ids.tmdb), "ids.tmdb must be an integer");
      assert.ok(item.ids.tmdb > 0, "ids.tmdb must be positive");
    }
  }
});

test("a row whose catalog comes back empty is dropped, not shown", async () => {
  installFetch({ emptySort: "recent" });

  const { rows } = await loadTab("peliculas");

  assert.ok(rows.length > 0, "the non-empty rows still load");
  assert.ok(
    !rows.some((row) => row.title === "Estrenos"),
    "the empty Estrenos (sort=recent) row must be absent",
  );
});

test("an unknown tab id yields no rows", async () => {
  installFetch();
  const result = await loadTab("desconocida");
  assert.deepEqual(result, { rows: [] });
});
