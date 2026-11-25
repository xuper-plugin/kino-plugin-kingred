// @ts-check
/// <reference path="../kino.d.ts" />
// Pure, network-free normalization of KingRed's per-title stream JSON (the SourcesM/SourcesT files the
// Firebase Storage client downloads). Nothing here fetches: callers hand in the already-parsed JSON and
// get back flat source lists that episodes() and resolve() consume in later tasks.
//
//   cleanEmbed(raw)   splits an optional `xxx::` server prefix off an embed url -> { url, serverHint? }.
//   mapLang(idioma)   folds the free-text language label into the four Kino buckets.
//   parseMovie(json)  { sources:[{idioma|language,url}] }           -> Source[] (one per source, in order)
//   parseSeries(json) { temporadas:[{temporada,capitulo,sources}] } -> { seasons: Map<number, Chapter[]> }
//
// A source's language key is EITHER `idioma` or `language` (both appear in the wild); a raw url may carry
// a `vida::`/`wish::`/`lion::` prefix that names its hoster, or none (a direct host like yandex/ok.ru).

/** @typedef {{ lang: string, label: string, url: string, serverHint?: string }} Source */
/** @typedef {{ season: number, episode: number, sources: Source[] }} Chapter */

/** Prefix token -> canonical server name used across the resolver door. An unknown token is its own name. */
const SERVER_BY_TOKEN = {
  vida: "vidara",
  wish: "streamwish",
  lion: "filelions",
};

/**
 * Splits an optional `token::` server prefix off a raw embed url. With a prefix, `serverHint` is the
 * canonical server for a known token or the token's own text for an unknown one; with no prefix the url
 * is returned as-is and `serverHint` is omitted.
 * @param {string} raw
 * @returns {{ url: string, serverHint?: string }}
 */
export function cleanEmbed(raw) {
  const sep = raw.indexOf("::");
  // A real prefix is a short token, not the "://" of a bare scheme (yandex, ok.ru, ...).
  if (sep > 0 && raw[sep + 2] !== "/") {
    const token = raw.slice(0, sep);
    return { url: raw.slice(sep + 2), serverHint: SERVER_BY_TOKEN[token] || token };
  }
  return { url: raw };
}

/**
 * Folds a free-text `idioma` label into one of the four Kino language buckets, case-insensitively.
 * @param {string} idioma
 * @returns {"Latino"|"Castellano"|"Subtitulado"|"Otro"}
 */
export function mapLang(idioma) {
  const s = String(idioma || "").toLowerCase();
  if (s.includes("latino")) return "Latino";
  if (s.includes("castellano")) return "Castellano";
  if (s.includes("sub")) return "Subtitulado";
  return "Otro";
}

/** Normalizes one `{idioma|language, url}` source. Keeps the raw label, tags the lang, cleans the url. */
function toSource(source) {
  const label = source.idioma != null ? source.idioma : (source.language != null ? source.language : "");
  const { url, serverHint } = cleanEmbed(String(source.url));
  /** @type {Source} */
  const out = { lang: mapLang(label), label, url };
  if (serverHint !== undefined) out.serverHint = serverHint;
  return out;
}

/** Maps a `sources[]` array (or a missing one) to a flat Source list, preserving order; none dropped. */
function toSources(sources) {
  return (Array.isArray(sources) ? sources : []).map(toSource);
}

/**
 * Parses a movie file `{ sources: [{ idioma|language, url }] }` into a flat Source list, one entry per
 * source in file order. No source is dropped; consumers group by `lang` later.
 * @param {any} json
 * @returns {Source[]}
 */
export function parseMovie(json) {
  return toSources(json && json.sources);
}

/**
 * Parses a series file `{ temporadas: [{ temporada, capitulo, sources }] }` into chapters grouped by
 * season number. `season`/`episode` are the numeric `temporada`/`capitulo`; `sources` is the same shape
 * parseMovie produces. Chapters keep their file order within each season.
 * @param {any} json
 * @returns {{ seasons: Map<number, Chapter[]> }}
 */
export function parseSeries(json) {
  /** @type {Map<number, Chapter[]>} */
  const seasons = new Map();
  const temporadas = json && Array.isArray(json.temporadas) ? json.temporadas : [];

  for (const t of temporadas) {
    const season = Number(t.temporada);
    const episode = Number(t.capitulo);
    /** @type {Chapter} */
    const chapter = { season, episode, sources: toSources(t.sources) };
    const list = seasons.get(season);
    if (list) list.push(chapter);
    else seasons.set(season, [chapter]);
  }

  return { seasons };
}
