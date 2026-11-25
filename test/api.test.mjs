// The KingRed catalog client (src/api.js): maps the st.kinghydra.site catalog into KinoItems and
// builds the request URL, omitting the optional params Kino leaves empty (an empty one is HTTP 422).
// kino.fetch is mocked with the real KinoResponse shape (a .status and a synchronous .json()/.text()),
// feeding the real captured responses from test/fixtures/.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { catalogPage, CATEGORIES, SORTS } from "../src/api.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/**
 * Installs a kino.fetch mock that answers every call with `body` (the real KinoResponse shape), and
 * records the URLs it is asked for. Returns the array of seen URLs.
 */
function mockFetch(body) {
  const urls = [];
  globalThis.kino = {
    fetch: async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        url,
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

test("movies page maps to KinoItems with m: refs and the movie kind", async () => {
  const body = fixture("catalog-movies.json");
  mockFetch(body);

  const { items, totalPages } = await catalogPage({ kind: "movies", page: 1 });
  const first = body.movies[0];

  assert.ok(items.length > 0, "expected at least one item");
  assert.equal(items[0].ref, "m:" + first.tmdb_id);
  assert.equal(items[0].id, "m" + first.tmdb_id);
  assert.equal(items[0].kind, "movie");
  assert.equal(items[0].title, first.title);
  assert.equal(items[0].poster, first.poster_url);
  assert.equal(items[0].backdrop, first.backdrop_url);
  assert.equal(items[0].overview, first.overview);
  assert.equal(totalPages, body.total_pages);
});

test("series page maps to KinoItems with t: refs and the series kind", async () => {
  const body = fixture("catalog-series.json");
  mockFetch(body);

  const { items, totalPages } = await catalogPage({ kind: "series", page: 1 });
  const first = body.series[0];

  assert.ok(items.length > 0, "expected at least one item");
  assert.equal(items[0].ref, "t:" + first.tmdb_id);
  assert.equal(items[0].id, "t" + first.tmdb_id);
  assert.equal(items[0].kind, "series");
  assert.equal(items[0].poster, first.poster_url);
  assert.equal(totalPages, body.total_pages);
});

test("every item id is colon-free and matches the KinoItem.id pattern", async () => {
  // kino.d.ts:33 requires id to match ^[A-Za-z0-9._~-]{1,128}$, which excludes the colon of ref.
  const ID = /^[A-Za-z0-9._~-]{1,128}$/;
  for (const file of ["catalog-movies.json", "catalog-series.json"]) {
    const body = fixture(file);
    mockFetch(body);
    const kind = body.movies ? "movies" : "series";
    const { items } = await catalogPage({ kind, page: 1 });
    assert.ok(items.length > 0, `expected items for ${file}`);
    for (const item of items) {
      assert.match(item.id, ID, `id "${item.id}" must match KinoItem.id pattern`);
      assert.notEqual(item.id, item.ref, "id must not equal the colon-bearing ref");
    }
  }
});

test("a search builds the URL with q= and omits empty category/sort", async () => {
  const body = fixture("search-movies-batman.json");
  const urls = mockFetch(body);

  const { items } = await catalogPage({ kind: "movies", page: 1, q: "batman" });

  assert.equal(urls.length, 1, "expected exactly one request");
  const url = new URL(urls[0]);
  assert.equal(url.origin + url.pathname, "https://st.kinghydra.site/api/catalog/movies");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("q"), "batman");
  assert.ok(!url.searchParams.has("category"), "empty category must be omitted");
  assert.ok(!url.searchParams.has("sort"), "empty sort must be omitted");

  assert.equal(items[0].ref, "m:" + body.movies[0].tmdb_id);
});

test("category and sort are sent only when given", async () => {
  const body = fixture("catalog-movies.json");
  const urls = mockFetch(body);

  await catalogPage({ kind: "movies", page: 2, category: "accion", sort: "recent" });

  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("category"), "accion");
  assert.equal(url.searchParams.get("sort"), "recent");
  assert.ok(!url.searchParams.has("q"), "empty q must be omitted");
});

test("CATEGORIES and SORTS are the design enums", () => {
  assert.deepEqual(SORTS, ["popular", "year", "recent", "alpha", "manual", "added", "rating", "date"]);
  assert.deepEqual(CATEGORIES, [
    "accion", "anime", "comedia", "cristianas", "documentales",
    "doramas", "drama", "infantiles", "terror",
  ]);
});
