import fs from "node:fs/promises";
import path from "node:path";


/* =========================================================
   ALBERO TV — PROGRAMAS TAURINOS

   Comprueba las guías oficiales de:

   - Toros para Todos — Canal Sur
   - Tendido Cero — RTVE / La 2
   - Grana y Oro — CyLTV

   Genera:

   data/programas-taurinos.json
   ========================================================= */


const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "data",
  "programas-taurinos.json"
);


const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://github.com/)";


const PROGRAMS = [
  {
    id: "toros-para-todos",
    name: "Toros para Todos",
    channel: "Canal Sur Televisión",
    source: "Canal Sur",
    guideUrl:
      "https://www.canalsur.es/television/directo-television/",
    programUrl:
      "https://www.canalsur.es/television/toros-para-todos/",
    watchUrl:
      "https://www.canalsur.es/television/directo-television/"
  },

  {
    id: "tendido-cero",
    name: "Tendido Cero",
    channel: "La 2",
    source: "RTVE",
    guideUrl:
      "https://www.rtve.es/play/guia-tve/",
    programUrl:
      "https://www.rtve.es/play/videos/tendido-cero/",
    watchUrl:
      "https://www.rtve.es/play/videos/directo/la-2/"
  },

  {
    id: "grana-y-oro",
    name: "Grana y Oro",
    channel: "La 7 CyLTV",
    source: "CyLTV",
    guideUrl:
      "https://www.cyltv.es/guiatv",
    programUrl:
      "https://www.cyltv.es/granayoro",
    watchUrl:
      "https://www.cyltv.es/directo"
  }
];


/* =========================================================
   UTILIDADES
   ========================================================= */


function normalizeWhitespace(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeText(value = "") {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}


function decodeHtmlEntities(value = "") {
  const entities = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    ntilde: "ñ",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    Ntilde: "Ñ"
  };

  return String(value)
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, hexadecimal) =>
        String.fromCodePoint(
          Number.parseInt(hexadecimal, 16)
        )
    )
    .replace(
      /&#([0-9]+);/g,
      (_, decimal) =>
        String.fromCodePoint(
          Number.parseInt(decimal, 10)
        )
    )
    .replace(
      /&([a-zA-Z]+);/g,
      (match, entity) =>
        Object.prototype.hasOwnProperty.call(
          entities,
          entity
        )
          ? entities[entity]
          : match
    );
}


function stripHtml(html = "") {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(html)
        .replace(
          /<script\b[^>]*>[\s\S]*?<\/script>/gi,
          " "
        )
        .replace(
          /<style\b[^>]*>[\s\S]*?<\/style>/gi,
          " "
        )
        .replace(
          /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
          " "
        )
        .replace(
          /<br\s*\/?>/gi,
          "\n"
        )
        .replace(
          /<\/p>/gi,
          "\n"
        )
        .replace(
          /<\/div>/gi,
          "\n"
        )
        .replace(
          /<[^>]+>/g,
          " "
        )
    )
  );
}


function todayISO() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(
      now.getMonth() + 1
    ).padStart(2, "0"),
    String(
      now.getDate()
    ).padStart(2, "0")
  ].join("-");
}


/* =========================================================
   DESCARGA
   ========================================================= */


async function fetchPage(url) {
  const response = await fetch(
    url,
    {
      redirect: "follow",

      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml," +
          "application/xml;q=0.9,*/*;q=0.8",
        "accept-language":
          "es-ES,es;q=0.9,en;q=0.7"
      },

      signal:
        AbortSignal.timeout(30000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return {
    html: await response.text(),
    finalUrl: response.url
  };
}


/* =========================================================
   EXTRAER HORA CERCA DEL NOMBRE DEL PROGRAMA
   ========================================================= */


function extractTimeNearProgram(
  pageText,
  programName
) {
  const normalizedPage =
    normalizeText(pageText);

  const normalizedName =
    normalizeText(programName);

  const programPosition =
    normalizedPage.indexOf(
      normalizedName
    );

  if (programPosition === -1) {
    return "";
  }

  const start =
    Math.max(
      0,
      programPosition - 120
    );

  const end =
    Math.min(
      normalizedPage.length,
      programPosition + 180
    );

  const context =
    normalizedPage.slice(
      start,
      end
    );

  /*
    Primero buscamos una hora situada inmediatamente
    antes del nombre del programa.
  */

  const beforeProgram =
    normalizedPage.slice(
      start,
      programPosition
    );

  const timesBefore =
    [
      ...beforeProgram.matchAll(
        /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g
      )
    ];

  if (timesBefore.length) {
    const lastTime =
      timesBefore[
        timesBefore.length - 1
      ];

    return (
      String(lastTime[1]).padStart(2, "0") +
      ":" +
      lastTime[2]
    );
  }

  /*
    Si no existe delante, buscamos después.
  */

  const timeAfter =
    context.match(
      /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/
    );

  if (timeAfter) {
    return (
      String(timeAfter[1]).padStart(2, "0") +
      ":" +
      timeAfter[2]
    );
  }

  return "";
}


/* =========================================================
   PROCESAR UN PROGRAMA
   ========================================================= */


async function checkProgram(program) {
  console.log("");
  console.log(
    `Buscando: ${program.name}`
  );

  console.log(
    `Guía: ${program.guideUrl}`
  );

  try {
    const {
      html,
      finalUrl
    } =
      await fetchPage(
        program.guideUrl
      );

    const pageText =
      stripHtml(html);

    const found =
      normalizeText(pageText).includes(
        normalizeText(program.name)
      );

    const time =
      found
        ? extractTimeNearProgram(
            pageText,
            program.name
          )
        : "";

    if (found) {
      console.log(
        `ENCONTRADO: ${program.name}`
      );

      console.log(
        `Hora detectada: ${
          time ||
          "no encontrada"
        }`
      );
    } else {
      console.log(
        `NO ENCONTRADO: ${program.name}`
      );
    }

    return {
      id:
        `${program.id}-${todayISO()}`,

      source:
        program.source,

      title:
        program.name,

      type:
        "Programa taurino",

      contentType:
        "programa",

      date:
        todayISO(),

      time:
        time ||
        "Hora por confirmar",

      channel:
        program.channel,

      location:
        "Televisión",

      breeding:
        "",

      participants:
        [],

      found,

      guideUrl:
        finalUrl,

      sourceUrl:
        program.programUrl,

      eventUrl:
        program.watchUrl
    };
  } catch (error) {
    console.error(
      `ERROR: ${error.message}`
    );

    return {
      id:
        `${program.id}-${todayISO()}`,

      source:
        program.source,

      title:
        program.name,

      type:
        "Programa taurino",

      contentType:
        "programa",

      date:
        todayISO(),

      time:
        "Hora por confirmar",

      channel:
        program.channel,

      location:
        "Televisión",

      breeding:
        "",

      participants:
        [],

      found:
        false,

      error:
        error.message,

      guideUrl:
        program.guideUrl,

      sourceUrl:
        program.programUrl,

      eventUrl:
        program.watchUrl
    };
  }
}


/* =========================================================
   FUNCIÓN PRINCIPAL
   ========================================================= */


async function main() {
  console.log(
    "AlberoTV — Comprobación de programas taurinos"
  );

  const results = [];

  for (
    const program of PROGRAMS
  ) {
    const result =
      await checkProgram(program);

    results.push(result);

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          500
        )
    );
  }

  const foundPrograms =
    results.filter(
      program =>
        program.found
    );

  const output = {
    source:
      "Programas taurinos",

    updatedAt:
      new Date().toISOString(),

    checked:
      results.length,

    found:
      foundPrograms.length,

    /*
      En esta primera prueba guardamos todos los resultados,
      incluso los no encontrados, para poder diagnosticarlos.
    */

    programs:
      results,

    /*
      Esta será posteriormente la lista que se incorporará
      a programacion.json.
    */

    events:
      foundPrograms.map(
        program => {
          const {
            found,
            error,
            guideUrl,
            ...event
          } = program;

          return event;
        }
      )
  };

  await fs.mkdir(
    path.dirname(
      OUTPUT_FILE
    ),
    {
      recursive: true
    }
  );

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(
      output,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log("");
  console.log(
    "Comprobación terminada"
  );

  console.log(
    `${foundPrograms.length} de ${results.length} programas encontrados`
  );

  console.log(
    `Archivo creado: ${OUTPUT_FILE}`
  );
}


main().catch(error => {
  console.error("");
  console.error(
    "Error fatal:"
  );

  console.error(error);

  process.exitCode = 1;
});
