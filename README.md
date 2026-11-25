# KingRed (Kino plugin)

Películas y series de **KingRed** (`com.poison.kingred`) para [Kino](https://github.com/kinotvapp/kino-light).

Expone el catálogo público de KingRed —~21.000 películas y ~8.500 series— con Inicio,
búsqueda, fichas y temporadas. La reproducción se delega al motor compartido
**[Kino Resolver](https://github.com/xuper-plugin/kino-plugin-kino-resolver)**.

## Pantalla propia

KingRed trae su **pantalla propia** con pestañas (Inicio, Películas, Series, Animes,
Doramas, Acción, Terror, Comedia) y un **buscador integrado**. Desde ahí se abre también
la página de **Ajustes**.

## Requisitos

Este plugin **necesita el plugin Kino Resolver** para reproducir: cada enlace
(streamwish, vidhide, filelions, ok.ru, doodstream, filemoon, vidara, Yandex Disk…)
se resuelve a través de su puerta `resolver`. Si el resolver no está instalado, KingRed
muestra una pantalla que ofrece **instalarlo con un toque** (y lo lista en `recommends`).
Los hosters con gate JS que el resolver devuelve como `needs_browser` se capturan en el
WebView propio de KingRed (por eso figuran en `hosts`).

## Idiomas

El catálogo trae pistas en **Latino**, **Castellano** y **Subtitulado**; Kino abre la que
haya disponible por título y, si una falla, prueba las demás. En **Ajustes** eliges tu
**Idioma preferido** (Latino, Castellano o Subtitulado) y la reproducción arranca con ese
audio por defecto.

## Desarrollo

- Código en `src/`, empaquetado en `plugin.js` con `npm run build`.
- `npm test` — pruebas del manifiesto y del parseo de catálogo/streams.
- `npm run validate` — valida el bundle contra el contrato del SDK.
- Humo e2e contra el catálogo público (sin auth):
  `node sdk/run.mjs . home` y `node sdk/run.mjs . search "batman"`.
