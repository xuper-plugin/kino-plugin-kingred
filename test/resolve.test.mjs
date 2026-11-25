// resolve(ref) for movies and episodes (src/plugin.js): the playback core. A `m:<id>` reads
// SourcesM/<id>.json, a `t:<id>:<s>:<e>` reads the chapter of SourcesT/<id>.json; each source's embed is
// cleaned (src/streams.js), ranked inline-first, and sent to the kino-resolver door (src/resolve-door.js)
// until one resolves -- that copy is the KinoStream and the rest ride along as lazy `{ label, ref }`
// alternatives (a `k:<lang>:<embedUrl>` the "Servidor" menu hands back to resolve()). kino is mocked with an
// in-memory storage, a fetch routed by host (identitytoolkit -> a signUp token, firebasestorage -> the real
// SourcesM.json / SourcesT.json fixtures keyed by id), a programmable door (`plugins.call`) + capture
// (`browser.capture`), and a `kino.error(code,msg,opts)` that returns an Error carrying `code`/`userMessage`.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolve } from "../src/plugin.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_DIR, "..");
const FIXTURES = join(TEST_DIR, "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const MOVIE_DOC = fixture("SourcesM.json");
const SERIES_DOC = fixture("SourcesT.json");

// The resolver-door calls this plugin actually declares. The mocked door models the real protocol with it:
// Kino checks the DECLARED call list before provider existence, so an undeclared call throws not_declared,
// and only a declared call throws provider_missing (and only when the resolver is not installed).
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "kino-plugin.json"), "utf8"));
const DECLARED_CALLS = new Set(MANIFEST.consumes.resolver.calls);

const SIGNUP_HOST = "identitytoolkit.googleapis.com";
const STORAGE_HOST = "firebasestorage.googleapis.com";
const HLS_MIME = "application/vnd.apple.mpegurl";

// The first-ranked movie source: a vida:: (vidara) Latino copy. vidara is an inline host (tier 0) and Latino
// is the preferred language, so the (tier, langRank, order) sort puts it first -- yandex is no longer inline.
const MOVIE_FIRST = "https://vidara.to/e/lNCUFG6W4t2iL";
// Chapter 1's first-ranked source: the Latino wish:: copy. All four of the chapter's sources fall to the slow
// tier (wish/lion are gate hosts; bare vidara is not an inline-matched host), so Latino sorts first by language.
const EPISODE_LATINO = "https://hanerix.com/e/ix9i0ldeguy8";
// The chapter's Castellano (bare vidara) source -- ranks AFTER the two Latino ones within the same tier.
const EPISODE_CASTELLANO = "https://vidara.to/e/czYkngTSZ7K3g";

/** A KinoResponse-shaped object (synchronous json()/text(), .ok/.status), like src/firebase.js expects. */
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, url: "", headers: {}, json: () => body, text: () => JSON.stringify(body), base64: () => "" };
}

/**
 * Installs globalThis.kino: in-memory storage; a fetch that signs up anonymously and serves a doc keyed by
 * the id in the encoded Storage URL; a `plugins.call` door (`resolve` by url, `normalizeHost` the install
 * probe); a `browser.capture` mock; and a `kino.error` carrying code + userMessage.
 */
function installKino({ docs = {}, door = {}, capture = {}, probe = "ok", audio = undefined } = {}) {
  const store = new Map();
  const calls = { resolve: [], capture: [] };
  globalThis.kino = {
    storage: {
      get: (k) => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { store.set(k, v); },
      remove: (k) => { store.delete(k); },
      keys: () => [...store.keys()],
    },
    // The settings store resolve() reads for the preferred language ("audio": lat|cast|sub). Default
    // undefined so untouched cases behave as before (preferredLang() falls back to Latino-first).
    config: { get: (k) => (k === "audio" ? audio : undefined) },
    log() {},
    error(code, message, options) {
      const err = new Error(message || code);
      err.code = code;
      if (options && options.userMessage) err.userMessage = options.userMessage;
      return err;
    },
    fetch: async (url) => {
      if (url.includes(SIGNUP_HOST)) return response(200, { idToken: "tok-1", expiresIn: "3600" });
      if (url.includes(STORAGE_HOST)) {
        const id = Object.keys(docs).find((key) => url.includes("%2F" + key + ".json"));
        if (id === undefined) return response(404, { error: { message: "NOT_FOUND" } });
        return response(200, docs[id]);
      }
      throw new Error("unexpected fetch: " + url);
    },
    plugins: {
      // Model the real door protocol: the DECLARED call list is checked BEFORE provider existence. An
      // undeclared call throws not_declared; only a declared call throws provider_missing, and only when
      // the resolver is simulated absent (probe === "provider_missing"). This is what lets the install gate
      // fire -- the install probe (normalizeHost) must be a declared call for provider_missing to ever surface.
      call: async (_alias, name, arg) => {
        if (!DECLARED_CALLS.has(name)) throw Object.assign(new Error("not_declared"), { code: "not_declared" });
        if (name === "normalizeHost") {
          if (probe === "provider_missing") throw Object.assign(new Error("missing"), { code: "provider_missing" });
          return { host: "" };
        }
        calls.resolve.push(arg.url);
        const answer = door[arg.url];
        if (answer instanceof Error) throw answer;
        return answer || { streams: [], error: "needs_browser" };
      },
    },
    browser: {
      capture: async (url) => { calls.capture.push(url); return capture[url] || { media: [] }; },
    },
  };
  return { calls };
}

afterEach(() => { delete globalThis.kino; });

test("(a) m:<id> with the first inline source resolving returns a KinoStream with lazy alternatives", async () => {
  const { calls } = installKino({
    docs: { "1263337": MOVIE_DOC },
    door: { [MOVIE_FIRST]: { streams: [{ url: "https://cdn/movie.m3u8", server: "yandex" }] } },
  });

  const stream = await resolve("m:1263337");

  assert.equal(typeof stream.url, "string");
  assert.ok(stream.url.length > 0, "a non-empty url");
  assert.equal(stream.url, "https://cdn/movie.m3u8");
  assert.equal(stream.mime, HLS_MIME);
  assert.ok(typeof stream.label === "string" && stream.label.length > 0, "a non-empty label");

  // Laziness: the primary resolved first, so NO other source was touched -- exactly one door resolve call.
  assert.equal(calls.resolve.length, 1, "resolving stops at the primary; the rest stay lazy");
  assert.equal(calls.resolve[0], MOVIE_FIRST, "the one door call was for the first ranked (inline, Latino) source");

  assert.ok(Array.isArray(stream.alternatives), "alternatives is an array");
  assert.ok(stream.alternatives.length > 0, "a resolved primary leaves untried copies as alternatives");
  assert.ok(stream.alternatives.length <= 8, "at most 8 alternatives");
  for (const alt of stream.alternatives) {
    assert.equal(typeof alt.label, "string");
    assert.ok(alt.label.length > 0, "each alternative has a non-empty label");
    assert.ok(typeof alt.ref === "string" && alt.ref.startsWith("k:"), "each alternative is a lazy k: ref");
  }
});

test("(g) an alternative's ref round-trips: feeding it back to resolve() plays that copy", async () => {
  installKino({
    docs: { "1263337": MOVIE_DOC },
    door: { [MOVIE_FIRST]: { streams: [{ url: "https://cdn/movie.m3u8", server: "yandex" }] } },
  });

  const { alternatives } = await resolve("m:1263337");
  const alt = alternatives[0];

  // The lazy ref the "Servidor" menu would hand back: k:<lang>:<embedUrl> (embedUrl keeps its own `://`).
  const rest = alt.ref.slice(2);
  const i = rest.indexOf(":");
  const lang = rest.slice(0, i);
  const embedUrl = rest.slice(i + 1);
  assert.ok(embedUrl.startsWith("http"), "the ref carries a real embed url");

  // Close the loop: a fresh kino whose door resolves exactly that embed.
  installKino({ door: { [embedUrl]: { streams: [{ url: "https://cdn/alt.m3u8" }] } } });

  const stream = await resolve(alt.ref);
  assert.equal(stream.url, "https://cdn/alt.m3u8", "the alternative resolves to a playable stream");
  assert.equal(stream.label, lang, "and it is labeled with that copy's language");
});

test("(b) a provider_missing door probe makes resolve() throw unavailable with a userMessage", async () => {
  // The install probe (normalizeHost) is a DECLARED call, so the absent resolver surfaces as provider_missing
  // (not not_declared); resolverInstalled() reads that as "not installed" and the gate fires before storage.
  installKino({ docs: { "1263337": MOVIE_DOC }, probe: "provider_missing" });

  await assert.rejects(
    () => resolve("m:1263337"),
    (err) => {
      assert.equal(err.code, "unavailable");
      assert.ok(typeof err.userMessage === "string" && err.userMessage.length > 0, "a non-empty userMessage");
      return true;
    },
  );
});

test("(c) a movie file with no sources throws a readable 'servidores' error", async () => {
  installKino({ docs: { "1263337": { sources: [] } } });

  await assert.rejects(
    () => resolve("m:1263337"),
    (err) => {
      assert.ok(err.userMessage && err.userMessage.includes("servidores"), "userMessage mentions servidores");
      return true;
    },
  );
});

test("(d) a needs_browser source that captures returns the captured stream", async () => {
  installKino({
    docs: { "1263337": MOVIE_DOC },
    door: { [MOVIE_FIRST]: { streams: [], error: "needs_browser" } },
    capture: { [MOVIE_FIRST]: { media: [{ url: "https://cdn/captured.m3u8", headers: {} }] } },
  });

  const stream = await resolve("m:1263337");

  assert.equal(stream.url, "https://cdn/captured.m3u8", "the captured url is the primary");
  assert.equal(stream.mime, HLS_MIME);
});

test("(e) k:<lang>:<embedUrl> resolves that single embed and labels it with the lang", async () => {
  const embed = "https://vidara.to/e/abc";
  installKino({ door: { [embed]: { streams: [{ url: "https://cdn/single.m3u8" }] } } });

  const stream = await resolve("k:Latino:" + embed);

  assert.equal(stream.url, "https://cdn/single.m3u8");
  assert.equal(stream.label, "Latino");
});

test("(f) t:<id>:<s>:<e> resolves the chapter's first-ranked (Latino) source into a KinoStream", async () => {
  installKino({
    docs: { "1396": SERIES_DOC },
    door: { [EPISODE_LATINO]: { streams: [{ url: "https://cdn/ep.m3u8" }] } },
  });

  const stream = await resolve("t:1396:1:1");

  assert.equal(stream.url, "https://cdn/ep.m3u8");
  assert.ok(typeof stream.label === "string" && stream.label.length > 0, "a non-empty label");
  assert.ok(stream.label.startsWith("Latino"), "the first-ranked copy is Latino, so it is the primary");
  assert.ok(Array.isArray(stream.alternatives), "alternatives is an array");
});

test("(h) series within a tier: Latino sorts before Castellano, so Latino plays as primary", async () => {
  // Chapter 1's four sources all fall to the slow tier, so the language rank is the tie-break: the sort key
  // (tier asc, langRank asc, original order) puts the two Latino copies ahead of the Castellano and Subtitulado.
  installKino({
    docs: { "1396": SERIES_DOC },
    door: {
      [EPISODE_LATINO]: { streams: [{ url: "https://cdn/l-wish.m3u8" }] },
      "https://filelions.top/embed/32aryo4qs9py": { streams: [{ url: "https://cdn/l-lion.m3u8" }] },
      [EPISODE_CASTELLANO]: { streams: [{ url: "https://cdn/cast.m3u8" }] },
      "https://vidara.to/e/ltnavZTZ8WCZv": { streams: [{ url: "https://cdn/sub.m3u8" }] },
    },
  });

  const stream = await resolve("t:1396:1:1");

  assert.ok(stream.label.startsWith("Latino"), "the Latino copy plays as primary within the tier");
  const labels = [stream.label, ...stream.alternatives.map((a) => a.label)];
  const lastLatino = labels.map((l) => l.startsWith("Latino")).lastIndexOf(true);
  const firstCastellano = labels.findIndex((l) => l.startsWith("Castellano"));
  assert.ok(firstCastellano > lastLatino, "every Latino copy ranks before the first Castellano one");
});

test("(j) with the preferred language set to Castellano, the Castellano copy plays as primary within a tier", async () => {
  // Same chapter as (h) -- all four sources share the slow tier, so the language rank is the tie-break.
  // With "audio" = "cast" the dynamic rank puts Castellano at 0, so it beats both Latino copies.
  installKino({
    audio: "cast",
    docs: { "1396": SERIES_DOC },
    door: {
      [EPISODE_LATINO]: { streams: [{ url: "https://cdn/l-wish.m3u8" }] },
      "https://filelions.top/embed/32aryo4qs9py": { streams: [{ url: "https://cdn/l-lion.m3u8" }] },
      [EPISODE_CASTELLANO]: { streams: [{ url: "https://cdn/cast.m3u8" }] },
      "https://vidara.to/e/ltnavZTZ8WCZv": { streams: [{ url: "https://cdn/sub.m3u8" }] },
    },
  });

  const stream = await resolve("t:1396:1:1");

  assert.ok(stream.label.startsWith("Castellano"), "the preferred (Castellano) copy plays as primary");
  assert.equal(stream.url, "https://cdn/cast.m3u8", "and it is the resolved Castellano stream");
});

test("(k) an absent/invalid preferred language keeps Latino primary (default unchanged)", async () => {
  // "audio" = "xx" is not one of lat|cast|sub, so preferredLang() falls back to Latino -- today's behavior.
  installKino({
    audio: "xx",
    docs: { "1396": SERIES_DOC },
    door: {
      [EPISODE_LATINO]: { streams: [{ url: "https://cdn/l-wish.m3u8" }] },
      "https://filelions.top/embed/32aryo4qs9py": { streams: [{ url: "https://cdn/l-lion.m3u8" }] },
      [EPISODE_CASTELLANO]: { streams: [{ url: "https://cdn/cast.m3u8" }] },
      "https://vidara.to/e/ltnavZTZ8WCZv": { streams: [{ url: "https://cdn/sub.m3u8" }] },
    },
  });

  const stream = await resolve("t:1396:1:1");

  assert.ok(stream.label.startsWith("Latino"), "an unknown preference leaves Latino as primary");
});

test("(l) resolving a movie notes it for the std 'Continuar viendo' row; a chapter does not (series exclusion)", async () => {
  // The std screen is a module-level singleton (`let std`) that binds to the kino live when it is first built, so a
  // storage assertion on globalThis.kino would read the wrong store once an earlier test has created it. A fresh module
  // instance (a cache-busting query) gives this test its own `std`, bound to the kino installed right here -- deterministic
  // regardless of test order. The kit's recent row lives under RECENT_KEY ("recent1"); playedKey("m:<id>") is "t:<id>".
  const { resolve: freshResolve } = await import("../src/plugin.js?recent=" + Date.now());

  installKino({
    docs: { "1263337": MOVIE_DOC, "1396": SERIES_DOC },
    door: {
      [MOVIE_FIRST]: { streams: [{ url: "https://cdn/movie.m3u8", server: "yandex" }] },
      [EPISODE_LATINO]: { streams: [{ url: "https://cdn/ep.m3u8" }] },
    },
  });

  // A chapter resolves fine but is NOT noted: KingRed's t:<id>:<s>:<e> ref does not match the std kit's m/s/e playedKey,
  // so noting it could never surface a card. The recent key stays unset.
  const chapter = await freshResolve("t:1396:1:1");
  assert.equal(chapter.url, "https://cdn/ep.m3u8", "the chapter still resolves to a playable stream");
  assert.equal(kino.storage.get("recent1"), null, "a resolved chapter leaves the recent row empty (series exclusion)");

  // A movie resolves AND is noted, under the kit's recent key, keyed by its TMDB id (playedKey turns m:<id> into t:<id>).
  const movie = await freshResolve("m:1263337");
  assert.equal(movie.url, "https://cdn/movie.m3u8", "the movie still resolves to a playable stream");
  const recent = JSON.parse(kino.storage.get("recent1") || "null");
  assert.ok(Array.isArray(recent) && recent.includes("t:1263337"), "the played movie is recorded in the recent row");
});

test("(i) a storage fetch that throws surfaces a readable not_found, never a raw error", async () => {
  // No doc for this id -> the Storage GET 404s -> storageJson throws a plain Error. resolve() must wrap it in a
  // kino.error with a userMessage, the way episodes() swallows a missing document, not leak the bare Error.
  installKino({ docs: {} });

  await assert.rejects(
    () => resolve("m:999999"),
    (err) => {
      assert.equal(err.code, "not_found");
      assert.ok(typeof err.userMessage === "string" && err.userMessage.length > 0, "a non-empty userMessage");
      return true;
    },
  );
});
