// @ts-check
/// <reference path="../kino.d.ts" />
// The resolver install-gate: the two screens screen() picks between. KingRed plays every link through the
// shared kino-resolver door, so until that engine is installed there is nothing to play -- gateView() asks
// the person to install it (a button whose `go.installPlugin` Kino handles itself), and readyView() is the
// plain "all set" screen shown once it is. Kept minimal and self-contained (inline texts, no shared view kit).

/** The resolver this plugin recommends and plays through; the manifest lists it under `recommends`. */
export const RESOLVER_REPO = "xuper-plugin/kino-plugin-kino-resolver";

/** The install gate: shown while the resolver is missing. Its button's `go` is handled by Kino directly. */
export function gateView() {
  return {
    type: "Scaffold",
    appBar: { type: "AppBar", title: { type: "Text", text: "KingRed" } },
    body: {
      type: "Column",
      key: "gate",
      mainAxisAlignment: "center",
      crossAxisAlignment: "center",
      padding: 24,
      gap: 16,
      children: [
        { type: "Text", key: "gateTitle", style: "h3", text: "Falta el motor de reproducción" },
        {
          type: "Text",
          key: "gateText",
          style: "p",
          text: "KingRed usa Kino Resolver para abrir los enlaces. Instálalo para reproducir.",
        },
        {
          type: "ElevatedButton",
          key: "installResolver",
          labelText: "Instalar Kino Resolver",
          onPressed: { go: { installPlugin: { repo: RESOLVER_REPO } } },
        },
      ],
    },
  };
}

/** The "all set" screen: shown once the resolver is installed. Carries no "installResolver" node. */
export function readyView() {
  return {
    type: "Scaffold",
    appBar: { type: "AppBar", title: { type: "Text", text: "KingRed" } },
    body: {
      type: "Column",
      key: "ready",
      mainAxisAlignment: "center",
      crossAxisAlignment: "center",
      padding: 24,
      gap: 16,
      children: [
        { type: "Text", key: "ready", style: "p", text: "Todo listo. Busca o explora KingRed desde Inicio." },
      ],
    },
  };
}
