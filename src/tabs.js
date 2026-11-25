// @ts-check
/// <reference path="../kino.d.ts" />
// The KingRed tab model for the std screen kit: TABS declares the eight category tabs, and
// loadTab(tabId) builds that tab's rows by calling catalogPage (./api.js) once per row, all at once.
// Each row maps a slice of the catalog to a KinoRow; a row that errors or returns zero items is
// dropped so the screen only shows what has content (the resilient home() pattern). Every item
// carries ids.tmdb, recovered from its ref, so Kino's title pages fill without an extra meta lookup.

import { catalogPage } from "./api.js";

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
 * The row recipe per tab: each entry is one catalogPage call with a stable row `id`, its Spanish
 * `title`, and the `params` passed to catalogPage ({ kind, sort, category }).
 * @type {Record<string, Array<{ id: string, title: string, params: Parameters<typeof catalogPage>[0] }>>}
 */
const TAB_ROWS = {
  inicio: [
    { id: "inicio-peliculas", title: "Películas populares", params: { kind: "movies", sort: "popular" } },
    { id: "inicio-estrenos", title: "Estrenos", params: { kind: "movies", sort: "recent" } },
    { id: "inicio-series", title: "Series populares", params: { kind: "series", sort: "popular" } },
    { id: "inicio-anime", title: "Anime", params: { kind: "series", category: "anime", sort: "popular" } },
    { id: "inicio-terror", title: "Terror", params: { kind: "movies", category: "terror", sort: "popular" } },
  ],
  peliculas: [
    { id: "peliculas-popular", title: "Populares", params: { kind: "movies", sort: "popular" } },
    { id: "peliculas-recent", title: "Estrenos", params: { kind: "movies", sort: "recent" } },
    { id: "peliculas-rating", title: "Mejor valoradas", params: { kind: "movies", sort: "rating" } },
  ],
  series: [
    { id: "series-popular", title: "Populares", params: { kind: "series", sort: "popular" } },
    { id: "series-recent", title: "Recientes", params: { kind: "series", sort: "recent" } },
  ],
  animes: [
    { id: "animes-popular", title: "Populares", params: { kind: "series", category: "anime", sort: "popular" } },
    { id: "animes-recent", title: "Recientes", params: { kind: "series", category: "anime", sort: "recent" } },
  ],
  doramas: [
    { id: "doramas-popular", title: "Populares", params: { kind: "series", category: "doramas", sort: "popular" } },
    { id: "doramas-recent", title: "Recientes", params: { kind: "series", category: "doramas", sort: "recent" } },
  ],
  accion: [
    { id: "accion-popular", title: "Populares", params: { kind: "movies", category: "accion", sort: "popular" } },
    { id: "accion-recent", title: "Recientes", params: { kind: "movies", category: "accion", sort: "recent" } },
  ],
  terror: [
    { id: "terror-popular", title: "Populares", params: { kind: "movies", category: "terror", sort: "popular" } },
    { id: "terror-recent", title: "Recientes", params: { kind: "movies", category: "terror", sort: "recent" } },
  ],
  comedia: [
    { id: "comedia-popular", title: "Populares", params: { kind: "movies", category: "comedia", sort: "popular" } },
    { id: "comedia-recent", title: "Recientes", params: { kind: "movies", category: "comedia", sort: "recent" } },
  ],
};

/**
 * Returns a copy of a catalog item tagged with `ids.tmdb` when the ref's numeric id is a positive
 * integer; otherwise the item is returned unchanged (no `ids`). The ref is `m:`/`t:` + tmdb_id.
 * @param {import("../kino.d.ts").KinoItem} item
 * @returns {import("../kino.d.ts").KinoItem}
 */
function withIds(item) {
  const tmdb = Number(String(item.ref).split(":")[1]);
  if (Number.isInteger(tmdb) && tmdb > 0) return { ...item, ids: { tmdb } };
  return item;
}

/**
 * Builds one KinoRow from a single catalogPage call. Returns null when the call errors or yields no
 * items, so loadTab can drop the row instead of showing an empty one.
 * @param {{ id: string, title: string, params: Parameters<typeof catalogPage>[0] }} spec
 * @returns {Promise<import("../kino.d.ts").KinoRow | null>}
 */
async function rowFrom({ id, title, params }) {
  try {
    const { items } = await catalogPage(params);
    if (!items || items.length === 0) return null;
    return { id, title, items: items.map(withIds) };
  } catch {
    return null;
  }
}

/**
 * Loads a tab's rows for the std screen kit: every row's catalogPage call runs concurrently, rows
 * that error or come back empty are dropped, and the surviving rows keep their declared order. An
 * unknown tab id yields no rows.
 * @param {string} tabId
 * @returns {Promise<{ rows: import("../kino.d.ts").KinoRow[] }>}
 */
export async function loadTab(tabId) {
  const specs = TAB_ROWS[tabId];
  if (!specs) return { rows: [] };
  const built = await Promise.all(specs.map(rowFrom));
  const rows = built.filter((row) => row != null);
  return { rows };
}
