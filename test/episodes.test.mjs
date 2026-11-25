// episodes(ref) for series (src/plugin.js): parses "t:<tmdbId>", downloads SourcesT/<tmdbId>.json from
// Firebase Storage (src/firebase.js), flattens the seasons from parseSeries (src/streams.js) into a flat,
// ascending KinoEpisode[] whose refs feed resolve() in a later task. kino is mocked with an in-memory
// storage and a fetch routed by host: identitytoolkit -> a signUp token, firebasestorage -> the real
// SourcesT.json fixture (or an inline doc, keyed by the tmdbId in the encoded URL).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { episodes } from "../src/plugin.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const SERIES_DOC = JSON.parse(readFileSync(join(FIXTURES, "SourcesT.json"), "utf8"));

const SIGNUP_HOST = "identitytoolkit.googleapis.com";
const STORAGE_HOST = "firebasestorage.googleapis.com";

/** A KinoResponse-shaped object (synchronous json()/text(), .ok/.status), like src/firebase.js's mock. */
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
 * Installs globalThis.kino with an in-memory storage and a fetch that signs up anonymously and serves a
 * series doc keyed by tmdbId: `docs[tmdbId]` as the 200 body, or a 404 when the id is unknown.
 */
function installKino(docs) {
  const store = new Map();
  globalThis.kino = {
    storage: {
      get: (k) => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { store.set(k, v); },
      remove: (k) => { store.delete(k); },
      keys: () => [...store.keys()],
    },
    fetch: async (url) => {
      if (url.includes(SIGNUP_HOST)) return response(200, { idToken: "tok-1", expiresIn: "3600" });
      if (url.includes(STORAGE_HOST)) {
        const id = Object.keys(docs).find((key) => url.includes("SourcesT%2F" + key + ".json"));
        if (id === undefined) return response(404, { error: { message: "NOT_FOUND" } });
        return response(200, docs[id]);
      }
      throw new Error("unexpected fetch: " + url);
    },
  };
}

afterEach(() => { delete globalThis.kino; });

test('episodes("t:1396") returns a non-empty, ref-shaped, ascending episode list', async () => {
  installKino({ "1396": SERIES_DOC });

  const result = await episodes("t:1396");

  assert.ok(result && Array.isArray(result.episodes), "shape is { episodes: [...] }");
  assert.ok(result.episodes.length > 0, "episodes is non-empty");
  assert.equal("seasons" in result, false, "no seasons: Kino derives it from each episode's season");

  const first = result.episodes[0];
  assert.equal(first.ref, "t:1396:1:1", "first ref is t:<tmdbId>:<season>:<episode>");
  assert.equal(first.number, 1, "first episode number");
  assert.equal(first.season, 1, "first episode season");
  assert.equal(typeof first.title, "string");
  assert.ok(first.title.length > 0, "a non-empty title");

  // Every episode is ref-shaped and carries its required number.
  for (const ep of result.episodes) {
    assert.equal(ep.ref, `t:1396:${ep.season}:${ep.number}`);
    assert.equal(typeof ep.number, "number");
  }

  // series.ids.tmdb is the numeric tmdbId.
  assert.equal(result.series.ids.tmdb, 1396);
});

test("episodes are sorted by season ascending then number ascending", async () => {
  installKino({ "1396": SERIES_DOC });

  const { episodes: eps } = await episodes("t:1396");

  for (let i = 1; i < eps.length; i += 1) {
    const prev = eps[i - 1];
    const cur = eps[i];
    const ordered = prev.season < cur.season || (prev.season === cur.season && prev.number < cur.number);
    assert.ok(ordered, `episode ${i} (${cur.season}:${cur.number}) must follow ${prev.season}:${prev.number}`);
  }
});

test("a descending/out-of-order file is returned sorted ascending", async () => {
  const doc = {
    temporadas: [
      { temporada: "2", capitulo: "2", sources: [] },
      { temporada: "1", capitulo: "3", sources: [] },
      { temporada: "2", capitulo: "1", sources: [] },
      { temporada: "1", capitulo: "1", sources: [] },
    ],
  };
  installKino({ "42": doc });

  const { episodes: eps } = await episodes("t:42");

  assert.deepEqual(
    eps.map((e) => e.ref),
    ["t:42:1:1", "t:42:1:3", "t:42:2:1", "t:42:2:2"],
  );
});

test("a ref with no digits returns { episodes: [] } without throwing", async () => {
  installKino({ "1396": SERIES_DOC });

  assert.deepEqual(await episodes("t:"), { episodes: [] });
  assert.deepEqual(await episodes("bogus"), { episodes: [] });
  assert.deepEqual(await episodes(""), { episodes: [] });
});

test("a missing document (or one with no temporadas) returns { episodes: [] } without throwing", async () => {
  installKino({ "7": { note: "no temporadas here" } });

  // Unknown id -> the storage 404 must not escape as a throw.
  assert.deepEqual(await episodes("t:999999"), { episodes: [] });
  // A present doc without `temporadas`.
  assert.deepEqual(await episodes("t:7"), { episodes: [] });
});
