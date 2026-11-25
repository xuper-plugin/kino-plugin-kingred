// @ts-check
/// <reference path="../kino.d.ts" />
// The KingRed tab model for the std screen kit: TABS declares the eight category tabs, and
// loadTab(tabId) builds that tab's rows by calling catalogPage (./api.js) once per row, all at once.
// Each row maps a slice of the catalog to a KinoRow; a row that errors or returns zero items is
// dropped so the screen only shows what has content (the resilient home() pattern). Every item
// carries ids.tmdb (src/api.js), so Kino's title pages fill without an extra meta lookup, and every
// row carries the `ref` of its list, so the rail shows "Ver más" (browse(ref, cursor) pages the site).

import { catalogPage } from "./api.js";
import { listRef } from "./lists.js";
import { tIn } from "./i18n.js";

/** The eight KingRed tabs the std kit renders, in menu order (Spanish label + English fallback). */
export const TABS = [
  { id: "inicio", label: "Inicio", labelEn: "Home" },
  { id: "peliculas", label: "Películas", labelEn: "Movies" },
  { id: "series", label: "Series", labelEn: "Series" },
  { id: "animes", label: "Animes", labelEn: "Anime" },
  { id: "doramas", label: "Doramas", labelEn: "K-Drama" },
  { id: "accion", label: "Acción", labelEn: "Action" },
  { id: "terror", label: "Terror", labelEn: "Horror" },
  { id: "comedia", label: "Comedia", labelEn: "Comedy" },
];

/**
 * The row recipe per tab: each entry is one catalogPage call with a stable row `id`, the i18n key of
 * its title (`key`), and the `params` passed to catalogPage ({ kind, sort, category }).
 * @typedef {{ id: string, key: string, params: { kind: "movies" | "series", sort?: string, category?: string } }} RowSpec
 * @type {Record<string, RowSpec[]>}
 */
const TAB_ROWS = {
  inicio: [
    { id: "inicio-peliculas", key: "rowMoviesPopular", params: { kind: "movies", sort: "popular" } },
    { id: "inicio-estrenos", key: "rowMoviesRecent", params: { kind: "movies", sort: "recent" } },
    { id: "inicio-series", key: "rowSeriesPopular", params: { kind: "series", sort: "popular" } },
    { id: "inicio-anime", key: "cat_anime", params: { kind: "series", category: "anime", sort: "popular" } },
    { id: "inicio-terror", key: "cat_terror", params: { kind: "movies", category: "terror", sort: "popular" } },
  ],
  peliculas: [
    { id: "peliculas-popular", key: "rowPopular", params: { kind: "movies", sort: "popular" } },
    { id: "peliculas-recent", key: "rowMoviesRecent", params: { kind: "movies", sort: "recent" } },
    { id: "peliculas-rating", key: "rowMoviesRating", params: { kind: "movies", sort: "rating" } },
  ],
  series: [
    { id: "series-popular", key: "rowPopular", params: { kind: "series", sort: "popular" } },
    { id: "series-recent", key: "rowRecent", params: { kind: "series", sort: "recent" } },
  ],
  animes: [
    { id: "animes-popular", key: "rowPopular", params: { kind: "series", category: "anime", sort: "popular" } },
    { id: "animes-recent", key: "rowRecent", params: { kind: "series", category: "anime", sort: "recent" } },
  ],
  doramas: [
    { id: "doramas-popular", key: "rowPopular", params: { kind: "series", category: "doramas", sort: "popular" } },
    { id: "doramas-recent", key: "rowRecent", params: { kind: "series", category: "doramas", sort: "recent" } },
  ],
  accion: [
    { id: "accion-popular", key: "rowPopular", params: { kind: "movies", category: "accion", sort: "popular" } },
    { id: "accion-recent", key: "rowRecent", params: { kind: "movies", category: "accion", sort: "recent" } },
  ],
  terror: [
    { id: "terror-popular", key: "rowPopular", params: { kind: "movies", category: "terror", sort: "popular" } },
    { id: "terror-recent", key: "rowRecent", params: { kind: "movies", category: "terror", sort: "recent" } },
  ],
  comedia: [
    { id: "comedia-popular", key: "rowPopular", params: { kind: "movies", category: "comedia", sort: "popular" } },
    { id: "comedia-recent", key: "rowRecent", params: { kind: "movies", category: "comedia", sort: "recent" } },
  ],
};

/**
 * Builds one KinoRow from a single catalogPage call: the title in both languages, the list's ref for "Ver más".
 * Returns null when the call errors or yields no items, so loadTab can drop the row instead of showing an empty one.
 * @param {RowSpec} spec
 */
async function rowFrom({ id, key, params }) {
  try {
    const { items } = await catalogPage(params);
    if (!items || items.length === 0) return null;
    return { id, title: tIn("es", key), titleEn: tIn("en", key), ref: listRef(params), items };
  } catch {
    return null;
  }
}

/**
 * Loads a tab's rows for the std screen kit: every row's catalogPage call runs concurrently, rows
 * that error or come back empty are dropped, and the surviving rows keep their declared order. An
 * unknown tab id yields no rows.
 * @param {string} tabId
 */
export async function loadTab(tabId) {
  const specs = TAB_ROWS[tabId];
  if (!specs) return { rows: [] };
  const built = await Promise.all(specs.map(rowFrom));
  const rows = built.filter((row) => row != null);
  return { rows };
}
