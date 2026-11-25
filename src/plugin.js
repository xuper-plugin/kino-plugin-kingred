// @ts-check
/// <reference path="../kino.d.ts" />
// Kino plugin: KingRed -- the movies and series catalog of the KingRed app (com.poison.kingred),
// surfaced inside Kino. The catalog comes from st.kinghydra.site; the stream links live in Firebase
// Storage (anonymous login) and are played through the shared kino-resolver door.
//
// home() and search() are the Kino-facing catalog, built on the src/api.js client: home() lays out
// the design's rows (one catalog first-page each), search() runs `q=` over movies and series. The
// remaining contract functions are still stubs filled in by later tasks.
import { catalogPage } from "./api.js";
import { storageJson, TOKEN_KEY } from "./firebase.js";
import { parseMovie, parseSeries, cleanEmbed } from "./streams.js";
import { resolveViaHelper, resolverInstalled } from "./resolve-door.js";
import { makeStandardScreen } from "./std/index.js";
import { LOGO, LOGO_ASPECT } from "./logo.js";
import { TABS, loadTab } from "./tabs.js";

// The Home rows, in the order Kino shows them (movies first, then series). Each row is the catalog's
// FIRST page for a `sort` or `category`: there is no browse pagination (the plugin does not declare
// the `browse` capability), so a row carries no `ref` and shows no "Ver más". The `id` is a stable
// slug (it keys the row for Kino); `query` is the src/api.js catalogPage argument.
// The genre-rows (Acción/Comedia/Terror/Anime/Doramas) carry a `genre` from Kino's closed vocabulary so Kino
// groups them under Categorías; the movie-genre rows are all "peliculas", Anime is "anime", Doramas are "series".
// The plain populares/recientes/rating rows are not genres and carry none (Kino guesses from their title).
const HOME_ROWS = [
  { id: "movies-popular", title: "Películas populares", query: { kind: "movies", sort: "popular" } },
  { id: "movies-recent", title: "Estrenos", query: { kind: "movies", sort: "recent" } },
  { id: "movies-rating", title: "Mejor valoradas", query: { kind: "movies", sort: "rating" } },
  { id: "movies-accion", title: "Acción", genre: "peliculas", query: { kind: "movies", category: "accion" } },
  { id: "movies-comedia", title: "Comedia", genre: "peliculas", query: { kind: "movies", category: "comedia" } },
  { id: "movies-terror", title: "Terror", genre: "peliculas", query: { kind: "movies", category: "terror" } },
  { id: "series-popular", title: "Series populares", query: { kind: "series", sort: "popular" } },
  { id: "series-recent", title: "Series recientes", query: { kind: "series", sort: "recent" } },
  { id: "series-anime", title: "Anime", genre: "anime", query: { kind: "series", category: "anime" } },
  { id: "series-doramas", title: "Doramas", genre: "series", query: { kind: "series", category: "doramas" } },
];

/**
 * Home rows (populares, recientes, categorías, ...). The rows are fetched concurrently; each is
 * wrapped on its own and a row that errors OR comes back empty is DROPPED, so a wrong kind/category
 * combo or a network hiccup never breaks Home.
 * @returns {Promise<import("../kino.d.ts").KinoRow[]>}
 */
export async function home() {
  const rows = await Promise.all(
    HOME_ROWS.map(async ({ id, title, genre, query }) => {
      try {
        const { items } = await catalogPage(/** @type {any} */ (query));
        if (!items.length) return null;
        return genre ? { id, title, genre, items } : { id, title, items };
      } catch {
        return null;
      }
    }),
  );
  return /** @type {import("../kino.d.ts").KinoRow[]} */ (rows.filter((row) => row !== null));
}

/**
 * Catalog search over movies and series: one page of each (`q=`), movies first. The two kinds run
 * concurrently and each is wrapped on its own, so a failure of one still returns the other's hits.
 * An empty query returns [].
 * @param {import("../kino.d.ts").KinoSearchQuery & { query?: string }} query
 * @returns {Promise<import("../kino.d.ts").KinoItem[]>}
 */
export async function search(query) {
  const raw = query ? query.q ?? query.query : "";
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return [];

  const page = async (/** @type {"movies" | "series"} */ kind) => {
    try {
      return (await catalogPage({ kind, q: text })).items;
    } catch {
      return [];
    }
  };
  const [movies, series] = await Promise.all([page("movies"), page("series")]);
  return [...movies, ...series];
}

/**
 * A series' episodes, flattened across all its seasons. `ref` is `"t:<tmdbId>"`: episodes() downloads
 * SourcesT/<tmdbId>.json from Firebase Storage and turns the parsed seasons into a single KinoEpisode[],
 * sorted by season then episode ascending (the raw file may list chapters descending). Each episode's
 * `ref` is `"t:<tmdbId>:<season>:<episode>"`, the shape resolve() consumes. No `seasons` is returned --
 * Kino derives the season selector from each episode's `season`. A bad ref, a missing/empty document or
 * one without `temporadas` yields `{ episodes: [] }` instead of throwing, so the screen never breaks.
 * @param {string} ref
 * @returns {Promise<import("../kino.d.ts").KinoEpisodes>}
 */
export async function episodes(ref) {
  const match = /^t:(\d+)$/.exec(typeof ref === "string" ? ref : "");
  if (!match) return { episodes: [] };
  const tmdbId = match[1];

  let doc;
  try {
    doc = await storageJson("SourcesT/" + tmdbId + ".json");
  } catch {
    return { episodes: [] };
  }
  if (!doc || !Array.isArray(doc.temporadas)) return { episodes: [] };

  const { seasons } = parseSeries(doc);
  /** @type {import("../kino.d.ts").KinoEpisode[]} */
  const list = [];
  for (const chapters of seasons.values()) {
    for (const { season, episode } of chapters) {
      list.push({
        season,
        number: episode,
        ref: "t:" + tmdbId + ":" + season + ":" + episode,
        title: "Capítulo " + episode,
      });
    }
  }
  list.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.number - b.number);

  return { episodes: list, series: { ids: { tmdb: Number(tmdbId) } } };
}

// Hosts/servers that play straight away (the resolver reads them inline, no 20 s gate): they rank first so the
// person waits as little as possible. Everything else (streamwish, filelions, an unknown host) is a slow gate.
// disk.yandex is deliberately NOT here: the resolver has no Yandex extractor yet, so a Yandex embed comes back
// needs_browser -> a ~20 s WebView capture that usually fails for its big files. It falls to the slow tier so the
// known-good inline copies (vidara/ok.ru) are tried first; a Yandex extractor (gated Plan B) would restore tier 0.
const INLINE_SERVERS = ["vidara", "ok.ru"];
/** Within a speed tier, play the person's preferred language first: Latino > Castellano > Subtitulado > Otro. */
const LANG_RANK = { Latino: 0, Castellano: 1, Subtitulado: 2, Otro: 3 };
/** At most this many lazy copies ride along in a Stream's `alternatives` (the KinoStream limit). */
const MAX_ALTERNATIVES = 8;

/** The host of an absolute url (lowercased), or "" when it has none -- for inline-host matching. */
function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase() : "";
}

/**
 * A source's rank: 0 (fast/inline) when its serverHint or cleaned host is an INLINE_SERVER or it is a bare
 * direct file, else 2 (slow gate: streamwish/filelions/unknown). Lower plays first.
 */
function tierOf(cleanUrl, serverHint) {
  const hint = String(serverHint || "").toLowerCase();
  const host = hostOf(cleanUrl);
  // Match the host exactly or as a dotted suffix (ok.ru, foo.ok.ru), never as a bare substring: a
  // plain `host.includes("ok.ru")` would mis-tier an unrelated host like "look.rush.com" to inline.
  if (INLINE_SERVERS.some((name) => hint === name || host === name || host.endsWith("." + name))) return 0;
  if (/\.(mp4|m3u8|mkv|webm)(\?|#|$)/i.test(cleanUrl)) return 0;
  return 2;
}

/** A copy's "Servidor" label: the language, plus the hoster when known ("Latino · streamwish"). */
function labelOf(lang, serverHint) {
  return lang + (serverHint ? " · " + serverHint : "");
}

/**
 * Cleans, ranks (inline-first, stable) and resolves a title's sources through the kino-resolver door until the
 * FIRST one plays -- that copy is the KinoStream, every ranked copy AFTER it rides along as a lazy `{ label, ref }`
 * alternative (a `k:<lang>:<cleanUrl>` ref back to resolve()). Throws `not_found` with a readable message when
 * there are no sources or none resolve.
 * @param {import("./streams.js").Source[]} sources
 * @returns {Promise<import("../kino.d.ts").KinoStream>}
 */
async function playFromSources(sources) {
  const noSources = () =>
    kino.error("not_found", "no sources", { userMessage: "No hay servidores disponibles para este título." });
  if (!Array.isArray(sources) || !sources.length) throw noSources();

  // Clean each embed once (idempotent on an already-clean url) and tag it with its tier and language rank,
  // then sort ascending by (tier, langRank, original order). Array.prototype.sort is stable, so equal
  // (tier, langRank) copies keep their original (file) order. The language rank is the within-tier
  // tie-break: when two copies play equally fast, the preferred language (Latino) plays as primary --
  // without it, a series whose Castellano copy sits in a faster tier would always beat its Latino copy.
  const ranked = sources.map((source) => {
    const { url } = cleanEmbed(source.url);
    const langRank = LANG_RANK[source.lang] ?? LANG_RANK.Otro;
    return { lang: source.lang, serverHint: source.serverHint, cleanUrl: url, tier: tierOf(url, source.serverHint), langRank };
  });
  ranked.sort((a, b) => a.tier - b.tier || a.langRank - b.langRank);

  // Resolve in ranked order; the first non-null wins. Copies tried-and-failed before it are dropped.
  let primaryIndex = -1;
  let stream = null;
  for (let i = 0; i < ranked.length; i += 1) {
    stream = await resolveViaHelper(ranked[i].cleanUrl, kino, null, true);
    if (stream) { primaryIndex = i; break; }
  }
  if (!stream) throw noSources();

  /** @type {import("../kino.d.ts").KinoStreamAlternative[]} */
  const alternatives = [];
  for (let i = primaryIndex + 1; i < ranked.length && alternatives.length < MAX_ALTERNATIVES; i += 1) {
    const r = ranked[i];
    alternatives.push({ label: labelOf(r.lang, r.serverHint), ref: "k:" + r.lang + ":" + r.cleanUrl });
  }

  const primary = ranked[primaryIndex];
  const { url, mime, headers, subtitles } = stream;
  return {
    url,
    ...(mime !== undefined ? { mime } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(subtitles !== undefined ? { subtitles } : {}),
    label: labelOf(primary.lang, primary.serverHint),
    alternatives,
  };
}

/**
 * Resolve a movie, a chapter or a lazy single copy to a playable stream through the kino-resolver door.
 *   `m:<id>`              -> the movie's SourcesM sources, ranked and played (best copy + alternatives).
 *   `t:<id>:<s>:<e>`      -> that chapter's SourcesT sources, same.
 *   `k:<lang>:<embedUrl>` -> ONE embed this plugin itself emitted as an alternative, resolved directly.
 * A `k:` ref may resolve straight away; every other ref first checks the resolver is installed (before touching
 * storage) and, when it is not, throws `unavailable` with the install prompt.
 * @param {string} ref
 * @returns {Promise<import("../kino.d.ts").KinoStream>}
 */
export async function resolve(ref) {
  const raw = typeof ref === "string" ? ref : "";

  // A lazy copy the "Servidor" menu handed back: resolve just that embed (its own `://` colons are kept).
  if (raw.startsWith("k:")) {
    const rest = raw.slice(2);
    const i = rest.indexOf(":");
    if (i < 0) throw kino.error("not_found", "bad ref", { userMessage: "Enlace no válido." });
    const lang = rest.slice(0, i);
    const embedUrl = rest.slice(i + 1);
    const s = await resolveViaHelper(embedUrl, kino, null, true);
    if (!s) throw kino.error("not_found", "dead", { userMessage: "Este servidor no está disponible." });
    return { ...s, label: lang };
  }

  if (!(await resolverInstalled(kino))) {
    throw kino.error("unavailable", "resolver missing", {
      userMessage: "Para reproducir, instala el motor de reproducción (Kino Resolver) que el plugin te pedirá.",
    });
  }

  if (raw.startsWith("m:")) {
    const id = raw.slice(2);
    let doc;
    try {
      doc = await storageJson("SourcesM/" + id + ".json");
    } catch {
      // A catalog title with no SourcesM/<id>.json (a 404, say) must not leak storageJson's plain Error:
      // wrap it in a readable not_found, the way episodes() already swallows a missing document.
      throw kino.error("not_found", "no stream file", { userMessage: "Este título no está disponible." });
    }
    return playFromSources(parseMovie(doc));
  }

  const chapter = /^t:(\d+):(\d+):(\d+)$/.exec(raw);
  if (chapter) {
    const [, id, s, e] = chapter;
    let doc;
    try {
      doc = await storageJson("SourcesT/" + id + ".json");
    } catch {
      throw kino.error("not_found", "no stream file", { userMessage: "Este capítulo no está disponible." });
    }
    const { seasons } = parseSeries(doc);
    for (const chapters of seasons.values()) {
      for (const c of chapters) {
        if (c.season === Number(s) && c.episode === Number(e)) return playFromSources(c.sources);
      }
    }
    throw kino.error("not_found", "chapter not found", { userMessage: "Este capítulo no está disponible." });
  }

  throw kino.error("not_found", "unknown ref", { userMessage: "No se encontró este título." });
}

// ---- Ajustes ▸ KingRed ----

/**
 * The "Estado" status line on the plugin's own settings page: a short, plain-text summary of the
 * catalog (≤200 chars). KingRed keeps no per-list cache to count, so the line is a fixed description.
 * @returns {Promise<{ info: string }>}
 */
export async function settingsStatus() {
  return { info: "Catálogo de KingRed: películas y series." };
}

/**
 * Runs a settings action button. `clearCache` drops ONLY KingRed-owned state -- the cached anonymous
 * Firebase token (TOKEN_KEY) -- and never touches std's own storage keys; a missing token or an
 * unavailable storage is swallowed. An unknown key is a no-op `{ message: "" }` (never throws).
 * @param {string} key
 * @returns {Promise<{ message: string }>}
 */
export async function action(key) {
  if (key === "clearCache") {
    try { kino.storage.remove(TOKEN_KEY); } catch (_) { /* nothing to clear */ }
    return { message: "Listo" };
  }
  return { message: "" };
}

// ---- the screen: the standard xuper-plugin screen (src/std) ----

// KingRed plays every link through the shared kino-resolver door (resolve() refuses with an install prompt while it is
// missing), so the kit shows its own resolver install gate (`needsResolver: true`) until it is installed, then the browse
// screen built from TABS / loadTab (src/tabs.js). `hasSettings: true`: the manifest declares the settings form (Task 4).
let std = null;
const standard = () => (std ??= makeStandardScreen({
  kino, name: "KingRed", logo: LOGO, logoAspect: LOGO_ASPECT, needsResolver: true, hasSettings: true,
  tabs: TABS, loadTab,
}));

export async function screen(ctx) {
  await null;
  return standard().screen(ctx && typeof ctx === "object" ? ctx : {});
}

export async function screenEvent(ev) {
  await null;
  return standard().screenEvent(ev && typeof ev === "object" ? ev : {});
}
