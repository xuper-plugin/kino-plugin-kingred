// @ts-check
/// <reference path="../kino.d.ts" />
// Person-facing words in Spanish (neutral, tuteo) and English, picked by kino.lang at call time (never at import time),
// so the language follows the person's current setting. Code, comments and logs stay in English.

const WORDS = {
  es: {
    rowMoviesPopular: "Películas populares",
    rowMoviesRecent: "Estrenos",
    rowMoviesRating: "Mejor valoradas",
    rowSeriesPopular: "Series populares",
    rowSeriesRecent: "Series recientes",
    rowPopular: "Populares",
    rowRecent: "Recientes",
    cat_accion: "Acción",
    cat_anime: "Anime",
    cat_comedia: "Comedia",
    cat_cristianas: "Cristianas",
    cat_documentales: "Documentales",
    cat_doramas: "Doramas",
    cat_drama: "Drama",
    cat_infantiles: "Infantiles",
    cat_terror: "Terror",
    tileMoviesAnime: "Películas de anime",
    tileMoviesDoramas: "Cine asiático",
    tileSeriesDocumentales: "Series documentales",
    episode: "Capítulo {n}",
    noSources: "No hay servidores disponibles para este título.",
    badRef: "Enlace no válido.",
    deadServer: "Este servidor no está disponible.",
    needResolver: "Para reproducir, instala el motor de reproducción (Kino Resolver) que el plugin te pedirá.",
    titleMissing: "Este título no está disponible.",
    episodeMissing: "Este capítulo no está disponible.",
    notFound: "No se encontró este título.",
    catalogDown: "El catálogo de KingRed no responde ahora. Intenta de nuevo en un rato.",
    status: "Catálogo de KingRed: películas y series.",
    done: "Listo",
    lang_Latino: "Latino",
    lang_Castellano: "Castellano",
    lang_Subtitulado: "Subtitulado",
    lang_Otro: "Otro idioma",
  },
  en: {
    rowMoviesPopular: "Popular movies",
    rowMoviesRecent: "New releases",
    rowMoviesRating: "Top rated",
    rowSeriesPopular: "Popular series",
    rowSeriesRecent: "Recent series",
    rowPopular: "Popular",
    rowRecent: "Recent",
    cat_accion: "Action",
    cat_anime: "Anime",
    cat_comedia: "Comedy",
    cat_cristianas: "Christian",
    cat_documentales: "Documentaries",
    cat_doramas: "K-dramas",
    cat_drama: "Drama",
    cat_infantiles: "Kids",
    cat_terror: "Horror",
    tileMoviesAnime: "Anime movies",
    tileMoviesDoramas: "Asian cinema",
    tileSeriesDocumentales: "Docuseries",
    episode: "Episode {n}",
    noSources: "There are no servers available for this title.",
    badRef: "Invalid link.",
    deadServer: "This server is not available.",
    needResolver: "To play, install the playback engine (Kino Resolver) the plugin will ask you for.",
    titleMissing: "This title is not available.",
    episodeMissing: "This episode is not available.",
    notFound: "This title was not found.",
    catalogDown: "The KingRed catalog is not answering right now. Try again in a while.",
    status: "KingRed catalog: movies and series.",
    done: "Done",
    lang_Latino: "Latin American Spanish",
    lang_Castellano: "Castilian Spanish",
    lang_Subtitulado: "Subtitled",
    lang_Otro: "Other language",
  },
};

/** "en" when Kino runs in English, else "es". */
export function langOf(k = globalThis.kino) {
  return String((k && k.lang) || "").toLowerCase().startsWith("en") ? "en" : "es";
}

/** The words for `key` in [lang]; the Spanish ones when English lacks them, the key when both do. */
export function tIn(lang, key, vars) {
  const words = WORDS[lang === "en" ? "en" : "es"];
  const s = words[key] ?? WORDS.es[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
}

/** The words for `key` in the person's language, `{name}` placeholders filled from [vars]. */
export function t(key, vars) {
  return tIn(langOf(), key, vars);
}

/** For tests: every key, so both languages can be checked to hold the same set. */
export const KEYS = { es: Object.keys(WORDS.es), en: Object.keys(WORDS.en) };
