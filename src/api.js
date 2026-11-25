// @ts-check
/// <reference path="../kino.d.ts" />
// The KingRed catalog client: one page of movies or series from st.kinghydra.site, mapped into
// KinoItems that home() and search() hand back to Kino. The API is
//   GET https://st.kinghydra.site/api/catalog/{kind}?page=N[&q=][&category=][&sort=]
// with {kind} "movies" or "series"; the optional params are OMITTED when empty (an empty string
// answers HTTP 422). The response is { page, per_page, total, total_pages, movies|series: [...] },
// the array keyed by the same {kind}.

/** The catalog base; `{kind}` ("movies" | "series") and the query string are appended per call. */
export const CATALOG_BASE = "https://st.kinghydra.site/api/catalog";

/** The catalog's sort options (the design enum), in the order the UI offers them. */
export const SORTS = ["popular", "year", "recent", "alpha", "manual", "added", "rating", "date"];

/** The catalog's categories (the design enum). */
export const CATEGORIES = [
  "accion", "anime", "comedia", "cristianas", "documentales",
  "doramas", "drama", "infantiles", "terror",
];

// `tag` ("m"/"t") disambiguates a movie from a series that share a TMDB id. It builds the opaque
// `ref` ("m:"+tmdb_id) and the `id` ("m"+tmdb_id): the id must match KinoItem's ^[A-Za-z0-9._~-]{1,128}$
// (kino.d.ts:33), which EXCLUDES the colon, so the colon lives only in `ref`.
const KIND = {
  movies: { tag: "m", kind: "movie" },
  series: { tag: "t", kind: "series" },
};

/** Builds the catalog URL, appending only the query params that are present (empty ones are 422). */
function catalogUrl({ kind, page, category, sort, q }) {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (sort) params.set("sort", sort);
  return `${CATALOG_BASE}/${kind}?${params.toString()}`;
}

/** One catalog entry (movie or series) mapped to a KinoItem; `kind` is the singular Kino kind. */
function toItem(entry, { tag, kind }) {
  const ref = tag + ":" + entry.tmdb_id;
  const id = tag + entry.tmdb_id;
  /** @type {import("../kino.d.ts").KinoItem} */
  const item = { id, ref, title: entry.title, kind };
  if (entry.year !== undefined && entry.year !== null) item.year = entry.year;
  if (entry.poster_url) item.poster = entry.poster_url;
  if (entry.backdrop_url) item.backdrop = entry.backdrop_url;
  if (entry.overview) item.overview = entry.overview;
  // The catalog is keyed by TMDB: the id lets Kino's title page, Da-Video and "Continuar viendo" match the title.
  const tmdb = Number(entry.tmdb_id);
  if (Number.isInteger(tmdb) && tmdb > 0) item.ids = { tmdb };
  return item;
}

/**
 * Fetches one page of the KingRed catalog and maps it to KinoItems.
 * @param {{ kind: "movies" | "series", page?: number, category?: string, sort?: string, q?: string }} arg
 * @returns {Promise<{ items: import("../kino.d.ts").KinoItem[], totalPages: number }>}
 */
export async function catalogPage({ kind, page = 1, category, sort, q }) {
  const meta = KIND[kind];
  if (!meta) throw new Error(`unknown catalog kind: ${kind}`);

  const url = catalogUrl({ kind, page, category, sort, q });
  const res = await kino.fetch(url);
  if (!res.ok) throw new Error(`KingRed catalog ${res.status} ${url}`);

  const body = res.json();
  const list = Array.isArray(body && body[kind]) ? body[kind] : [];
  const items = list.map((entry) => toItem(entry, meta));
  const totalPages = Number.isFinite(body && body.total_pages) ? body.total_pages : 1;
  return { items, totalPages };
}
