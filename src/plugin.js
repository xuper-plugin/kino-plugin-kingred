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
import { parseSeries } from "./streams.js";

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

/** Resolve a movie or chapter to a playable stream via the kino-resolver door. */
export async function resolve() {
  throw new Error("not implemented");
}

/** The plugin's canvas: the resolver install gate once the real screen lands. */
export async function screen() {
  return { title: "KingRed", rows: [] };
}

/** Events from the screen (button presses, tab changes). */
export async function screenEvent() {
  return {};
}
