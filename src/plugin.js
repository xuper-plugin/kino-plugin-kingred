// @ts-check
// Kino plugin: KingRed -- the movies and series catalog of the KingRed app (com.poison.kingred),
// surfaced inside Kino. The catalog comes from st.kinghydra.site; the stream links live in Firebase
// Storage (anonymous login) and are played through the shared kino-resolver door.
//
// Task 1 scaffold: every declared contract function is a stub so the bundle is valid and installs.
// The catalog client, Firebase auth, stream parsing, the resolver-door helper and the install gate
// arrive in later tasks.

/** Home rows (populares, recientes, categorías, ...). */
export async function home() {
  return [];
}

/** Catalog search over movies and series. */
export async function search() {
  return [];
}

/** A series' seasons and chapters (from SourcesT in Firebase Storage). */
export async function episodes() {
  return { seasons: [], episodes: [] };
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
