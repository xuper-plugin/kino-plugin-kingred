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
import { storageJson } from "./firebase.js";
import { parseMovie, parseSeries, cleanEmbed } from "./streams.js";
import { resolveViaHelper, resolverInstalled } from "./resolve-door.js";

// The Home rows, in the order Kino shows them (movies first, then series). Each row is the catalog's
// FIRST page for a `sort` or `category`: there is no browse pagination (the plugin does not declare
// the `browse` capability), so a row carries no `ref` and shows no "Ver más". The `id` is a stable
// slug (it keys the row for Kino); `query` is the src/api.js catalogPage argument.
const HOME_ROWS = [
  { id: "movies-popular", title: "Películas populares", query: { kind: "movies", sort: "popular" } },
  { id: "movies-recent", title: "Estrenos", query: { kind: "movies", sort: "recent" } },
  { id: "movies-rating", title: "Mejor valoradas", query: { kind: "movies", sort: "rating" } },
  { id: "movies-accion", title: "Acción", query: { kind: "movies", category: "accion" } },
  { id: "movies-comedia", title: "Comedia", query: { kind: "movies", category: "comedia" } },
  { id: "movies-terror", title: "Terror", query: { kind: "movies", category: "terror" } },
  { id: "series-popular", title: "Series populares", query: { kind: "series", sort: "popular" } },
  { id: "series-recent", title: "Series recientes", query: { kind: "series", sort: "recent" } },
  { id: "series-anime", title: "Anime", query: { kind: "series", category: "anime" } },
  { id: "series-doramas", title: "Doramas", query: { kind: "series", category: "doramas" } },
];

/**
 * Home rows (populares, recientes, categorías, ...). The rows are fetched concurrently; each is
 * wrapped on its own and a row that errors OR comes back empty is DROPPED, so a wrong kind/category
 * combo or a network hiccup never breaks Home.
 * @returns {Promise<import("../kino.d.ts").KinoRow[]>}
 */
export async function home() {
  const rows = await Promise.all(
    HOME_ROWS.map(async ({ id, title, query }) => {
      try {
        const { items } = await catalogPage(/** @type {any} */ (query));
        if (!items.length) return null;
        return { id, title, items };
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
const INLINE_SERVERS = ["vidara", "ok.ru", "disk.yandex", "yandex"];
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
  if (INLINE_SERVERS.some((name) => hint === name || host.includes(name))) return 0;
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
  if (!sources.length) throw noSources();

  // Clean each embed once (idempotent on an already-clean url) and tag it with its tier, then stable-sort
  // ascending by tier: Array.prototype.sort keeps equal-tier copies in their original (file) order.
  const ranked = sources.map((source) => {
    const { url } = cleanEmbed(source.url);
    return { lang: source.lang, serverHint: source.serverHint, cleanUrl: url, tier: tierOf(url, source.serverHint) };
  });
  ranked.sort((a, b) => a.tier - b.tier);

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
    return playFromSources(parseMovie(await storageJson("SourcesM/" + id + ".json")));
  }

  const chapter = /^t:(\d+):(\d+):(\d+)$/.exec(raw);
  if (chapter) {
    const [, id, s, e] = chapter;
    const { seasons } = parseSeries(await storageJson("SourcesT/" + id + ".json"));
    for (const chapters of seasons.values()) {
      for (const c of chapters) {
        if (c.season === Number(s) && c.episode === Number(e)) return playFromSources(c.sources);
      }
    }
    throw kino.error("not_found", "chapter not found", { userMessage: "Este capítulo no está disponible." });
  }

  throw kino.error("not_found", "unknown ref", { userMessage: "No se encontró este título." });
}

/** The plugin's canvas: the resolver install gate once the real screen lands. */
export async function screen() {
  return { title: "KingRed", rows: [] };
}

/** Events from the screen (button presses, tab changes). */
export async function screenEvent() {
  return {};
}
