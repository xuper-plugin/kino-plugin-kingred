// The KingRed stream parser (src/streams.js): pure, network-free normalization of the per-title
// Storage JSON. cleanEmbed() strips a `xxx::` server prefix off a raw embed url, mapLang() folds the
// free-text idioma into the four Kino language buckets, and parseMovie()/parseSeries() turn the
// SourcesM/SourcesT file shapes into flat {lang,label,url,serverHint} source lists. The tests feed the
// real captured fixtures from test/fixtures/ and assert no source is ever dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanEmbed, mapLang, parseMovie, parseSeries } from "../src/streams.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

test("cleanEmbed strips a known server prefix and reports the canonical server", () => {
  assert.deepEqual(cleanEmbed("vida::https://vidara.to/e/x"), {
    url: "https://vidara.to/e/x",
    serverHint: "vidara",
  });
  assert.deepEqual(cleanEmbed("wish::https://audinifer.com/e/x"), {
    url: "https://audinifer.com/e/x",
    serverHint: "streamwish",
  });
  assert.deepEqual(cleanEmbed("lion::https://filelions.top/embed/x"), {
    url: "https://filelions.top/embed/x",
    serverHint: "filelions",
  });
});

test("cleanEmbed leaves a bare url intact with no serverHint", () => {
  assert.deepEqual(cleanEmbed("https://disk.yandex.com/i/x"), {
    url: "https://disk.yandex.com/i/x",
  });
  assert.deepEqual(cleanEmbed("https://ok.ru/video/123"), {
    url: "https://ok.ru/video/123",
  });
});

test("cleanEmbed keeps an unknown token as its own server text", () => {
  assert.deepEqual(cleanEmbed("foo::https://bar.example/e/x"), {
    url: "https://bar.example/e/x",
    serverHint: "foo",
  });
});

test("mapLang folds free-text idioma into the four buckets (case-insensitive)", () => {
  assert.equal(mapLang("Latino Con Calidades"), "Latino");
  assert.equal(mapLang("Castellano Descarga 1DM"), "Castellano");
  assert.equal(mapLang("Subtitulado Descarga 1DM"), "Subtitulado");
  assert.equal(mapLang("LATINO"), "Latino");
  assert.equal(mapLang("sub español"), "Subtitulado");
  assert.equal(mapLang("English"), "Otro");
  assert.equal(mapLang(""), "Otro");
});

test("parseMovie preserves every source, strips prefixes and tags the language", () => {
  const json = fixture("SourcesM.json");
  const parsed = parseMovie(json);

  assert.equal(parsed.length, json.sources.length, "no source dropped");

  // First source: a bare yandex url stays intact with no serverHint, tagged Latino.
  const yandex = parsed[0];
  assert.equal(yandex.label, "Latino Con Calidades");
  assert.equal(yandex.lang, "Latino");
  assert.equal(yandex.url, "https://disk.yandex.com/i/FEu1TBjGCSsh2Q");
  assert.equal(yandex.serverHint, undefined);

  // Second source: a vida:: url is cleaned and reports vidara.
  const vida = parsed[1];
  assert.equal(vida.lang, "Latino");
  assert.equal(vida.url, "https://vidara.to/e/lNCUFG6W4t2iL");
  assert.equal(vida.serverHint, "vidara");

  // A wish:: source somewhere in the file reports streamwish.
  const wish = parsed.find((s) => s.serverHint === "streamwish");
  assert.ok(wish, "expected a streamwish source");
  assert.ok(wish.url.startsWith("https://"), "the prefix is stripped off the wish url");

  // Every parsed url is prefix-free (no surviving `xxx::`).
  for (const s of parsed) assert.ok(!s.url.includes("::"), `url still carries a prefix: ${s.url}`);
});

test("parseMovie reads both the `idioma` and the `language` label keys", () => {
  const parsed = parseMovie({
    sources: [
      { language: "Latino HD", url: "vida::https://vidara.to/e/a" },
      { idioma: "Subtitulado", url: "https://ok.ru/v/1" },
    ],
  });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].label, "Latino HD");
  assert.equal(parsed[0].lang, "Latino");
  assert.equal(parsed[0].serverHint, "vidara");
  assert.equal(parsed[1].label, "Subtitulado");
  assert.equal(parsed[1].lang, "Subtitulado");
  assert.equal(parsed[1].serverHint, undefined);
});

test("parseSeries groups chapters under their season number and parses each chapter's sources", () => {
  const json = fixture("SourcesT.json");
  const { seasons } = parseSeries(json);

  assert.ok(seasons instanceof Map, "seasons is a Map keyed by season number");
  assert.ok(seasons.has(1), "season 1 exists");

  const s1 = seasons.get(1);
  // Season 1 in the fixture is capitulos 1..7.
  assert.equal(s1.length, 7, "season 1 has 7 chapters");
  assert.deepEqual(s1.map((e) => e.episode), [1, 2, 3, 4, 5, 6, 7]);
  for (const e of s1) assert.equal(e.season, 1);

  // The first chapter's sources are parsed into the same shape as parseMovie.
  const ch1 = s1[0];
  const raw = json.temporadas[0].sources;
  assert.equal(ch1.sources.length, raw.length);
  const lion = ch1.sources.find((s) => s.serverHint === "filelions");
  assert.ok(lion, "expected a filelions (lion::) source in chapter 1");
  assert.equal(lion.url, "https://filelions.top/embed/32aryo4qs9py");
  for (const s of ch1.sources) assert.ok(!s.url.includes("::"), `prefix survived: ${s.url}`);

  // Keys are numbers, not the raw "1"/"2" strings.
  for (const key of seasons.keys()) assert.equal(typeof key, "number");
});

test("parseSeries skips a malformed chapter whose temporada/capitulo are not finite numbers", () => {
  const { seasons } = parseSeries({
    temporadas: [
      { temporada: "1", capitulo: "1", sources: [{ idioma: "Latino", url: "https://ok.ru/v/1" }] },
      { temporada: "x", capitulo: "1", sources: [{ idioma: "Latino", url: "https://ok.ru/v/bad-season" }] },
      { temporada: "1", capitulo: "pilot", sources: [{ idioma: "Latino", url: "https://ok.ru/v/bad-ep" }] },
      { temporada: "2", capitulo: "3", sources: [{ idioma: "Latino", url: "https://ok.ru/v/2" }] },
    ],
  });

  // Only the two well-formed chapters survive; no NaN key is ever created.
  assert.deepEqual([...seasons.keys()], [1, 2]);
  for (const key of seasons.keys()) assert.ok(Number.isFinite(key), `season key ${key} is finite`);
  assert.equal(seasons.get(1).length, 1, "the malformed capitulo entry under season 1 is dropped");
  for (const chapters of seasons.values()) {
    for (const c of chapters) {
      assert.ok(Number.isFinite(c.season) && Number.isFinite(c.episode), "every surviving chapter has finite numbers");
    }
  }
});
