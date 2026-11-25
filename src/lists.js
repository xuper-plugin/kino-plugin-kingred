// @ts-check
/// <reference path="../kino.d.ts" />
// The browsable side: every catalog list (a kind, a sort, a category) as a "Ver más" ref that browse(ref, cursor) pages
// through, and the category tiles of Kino's Categorías. Every list the site serves is paginated
// (`?page=N`, 50 titles a page, `total_pages` in the answer), so every Home and tab row can carry a ref.

import { catalogPage, SORTS, CATEGORIES } from "./api.js";
import { t } from "./i18n.js";

/**
 * The ref of one catalog list: "kr:<movies|series>:<sort>:<category>", sort and category possibly empty.
 * @param {{ kind: "movies" | "series", sort?: string, category?: string }} params
 */
export function listRef({ kind, sort = "", category = "" }) {
  return `kr:${kind}:${sort}:${category}`;
}

/**
 * A list ref back as catalogPage's params, or null when it is not one (unknown kind, sort or category).
 * @param {unknown} ref
 * @returns {{ kind: "movies" | "series", sort?: string, category?: string } | null}
 */
export function parseListRef(ref) {
  const m = /^kr:(movies|series):([a-z]*):([a-z]*)$/.exec(String(ref || ""));
  if (!m) return null;
  const [, kind, sort, category] = m;
  if (sort && !SORTS.includes(sort)) return null;
  if (category && !CATEGORIES.includes(category)) return null;
  /** @type {{ kind: "movies" | "series", sort?: string, category?: string }} */
  const out = { kind: /** @type {"movies" | "series"} */ (kind) };
  if (sort) out.sort = sort;
  if (category) out.category = category;
  return out;
}

/** The last page browse() asks for: the biggest list (all movies) has ~420 pages. */
const MAX_PAGE = 1000;

/**
 * One "Ver más" page of a list ref: the site's page [cursor] (1 when null), and `next` while the site has more.
 * @param {string} ref
 * @param {string | null | undefined} cursor
 * @returns {Promise<import("../kino.d.ts").KinoPage>}
 */
export async function browsePage(ref, cursor) {
  const params = parseListRef(ref);
  if (!params) throw kino.error("not_found", "unknown browse ref");
  const n = /^\d{1,4}$/.test(String(cursor ?? "")) ? Number(cursor) : 1;
  const page = n >= 1 && n <= MAX_PAGE ? n : 1;
  let got;
  try {
    got = await catalogPage({ ...params, page });
  } catch (e) {
    throw kino.error("unavailable", "KingRed catalog: " + String((e && e.message) || e), { userMessage: t("catalogDown") });
  }
  const more = got.items.length > 0 && page < got.totalPages && page < MAX_PAGE;
  return more ? { items: got.items, next: String(page + 1) } : { items: got.items };
}

/**
 * One backdrop per tile: a well-known title of the category from KingRed's own catalog (or the same picture Latino uses for
 * the genre), its TMDB path at w780, each checked with a HEAD request on image.tmdb.org (200, image/jpeg). Static on
 * purpose: categories() asks nothing of the network, so Kino's Categorías paints at once.
 */
const TILE_ART = "https://image.tmdb.org/t/p/w780";
const MOVIE_TILES = [
  ["accion", "/gqrnQA6Xppdl8vIb2eJc58VC1tW.jpg"], // Mad Max: Fury Road
  ["comedia", "/jK65srQczOKTpW62wPxwwKztGgE.jpg"], // The Grand Budapest Hotel
  ["drama", "/pNjh59JSxChQktamG3LMp9ZoQzp.jpg"], // The Shawshank Redemption
  ["terror", "/nHRUtBwFNnNN70vcQ7lAsjc2T6S.jpg"], // A Quiet Place
  ["infantiles", "/iJgNOTSBNrC90U2xyYq9ln0b35o.jpg"], // Paddington 2
  ["anime", "/1RgPyOhN4DRs225BGTlHJqCudII.jpg", "tileMoviesAnime"], // Demon Slayer: Infinity Castle
  ["documentales", "/sW7VOrkHKYIeV9PaYc5IqGU2XK8.jpg"], // My Octopus Teacher
  ["doramas", "/wyv2Y9vXYJwJzF6cNVuVwVOsOUj.jpg", "tileMoviesDoramas"], // Along with the Gods
  ["cristianas", "/4840rkbpsiuow5ew155oVKcqJwj.jpg"], // The Passion of the Christ
];
// The site files only these three categories under series (the others answer an empty list for series).
const SERIES_TILES = [
  ["anime", "/2rmK7mnchw9Xr3XdiTFSxTTLXqv.jpg"], // One Piece
  ["doramas", "/fNcpHmuZLKoyhNMBEzdqzX8iIvg.jpg"], // The Remarried Empress
  ["documentales", "/1liP8laBgg5qK2f3yZdOKsxEhGz.jpg", "tileSeriesDocumentales"], // Black Swan Operation
];

/** Category tiles: movie categories, then series ones, each with a picture; each opens its list's "Ver más". */
export function categoryTiles() {
  const tile = (kind) => ([category, art, key]) => ({
    id: `${category}-${kind}`,
    title: t(key || "cat_" + category),
    ref: listRef({ kind, sort: "popular", category }),
    art: TILE_ART + art,
  });
  return [...MOVIE_TILES.map(tile("movies")), ...SERIES_TILES.map(tile("series"))].slice(0, 24);
}
