# AlberoTV + extractor de OneToro

Esta versión añade el primer conector automático de AlberoTV.

## Qué hace

El scraper abre la página de próximos festejos de OneToro con un navegador Chromium real mediante Playwright, espera a que cargue el contenido dinámico y guarda los candidatos encontrados en:

`data/onetoro.json`

No modifica todavía automáticamente la parrilla visible de AlberoTV. Primero guardamos y revisamos el resultado real de OneToro para ajustar el parser con precisión. Esa es la forma segura de hacerlo: extraer, revisar y después conectar.

## Probarlo en un ordenador

Necesitas Node.js 22 o compatible.

```bash
npm install
npx playwright install chromium
npm run scrape:onetoro
```

Después abre:

`data/onetoro.json`

## Automatización incluida

El archivo:

`.github/workflows/update-onetoro.yml`

ejecuta el extractor cuatro veces al día mediante GitHub Actions y guarda los cambios en el repositorio.

## Siguiente paso

Subir este proyecto a GitHub, ejecutar manualmente la acción una vez y revisar el contenido real generado en `data/onetoro.json`.

Con ese resultado ajustamos el extractor al HTML real de OneToro y, cuando quede fiable, conectamos los eventos validados directamente con la parrilla de AlberoTV.
