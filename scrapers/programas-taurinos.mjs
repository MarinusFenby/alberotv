import fs from "node:fs/promises";
import path from "node:path";


/* =========================================================
   ALBERO TV — PROGRAMAS TAURINOS

   Busca en las guías oficiales:

   - Toros para Todos — Canal Sur Televisión
   - Tendido Cero — La 2 de RTVE
   - Grana y Oro — CyLTV

   Genera:

   data/programas-taurinos.json
   ========================================================= */


const SCRAPER_VERSION =
  "2026-07-25-v3";


const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "data",
    "programas-taurinos.json"
  );


const TIME_ZONE =
  "Europe/Madrid";


const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";


const PROGRAMS = [
  {
    id:
      "toros-para-todos",

    title:
      "Toros para Todos",

    source:
      "Canal Sur",

    channel:
      "Canal Sur Televisión",

    guideUrls: [
      "https://www.canalsur.es/guia-programacion/canal-sur-television-79/",
      "https://www.canalsur.es/guia-programacion/"
    ],

    sourceUrl:
      "https://www.canalsur.es/television/toros-para-todos/",

    eventUrl:
      "https://www.canalsur.es/television/directo-television/"
  },

  {
    id:
      "tendido-cero",

    title:
      "Tendido Cero",

    source:
      "RTVE",

    channel:
      "La 2",

    guideUrls: [
      "https://www.rtve.es/play/guia-tve/"
    ],

    sourceUrl:
      "https://www.rtve.es/play/videos/tendido-cero/",

    eventUrl:
      "https://www.rtve.es/play/videos/directo/la-2/"
  },

  {
    id:
      "grana-y-oro",

    title:
      "Grana y Oro",

    source:
      "CyLTV",

    channel:
      "CyLTV",

    guideUrls: [
      "https://www.cyltv.es/guiatv"
    ],

    sourceUrl:
      "https://www.cyltv.es/granayoro",

    eventUrl:
      "https://www.cyltv.es/directo"
  }
];


/* =========================================================
   TEXTO
   ========================================================= */


function decodeHtmlEntities(value = "") {
  const entities = {
    amp: "&",
    quot: "\"",
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
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
      (_, value) =>
        String.fromCodePoint(
          Number.parseInt(value, 16)
        )
    )
    .replace(
      /&#([0-9]+);/g,
      (_, value) =>
        String.fromCodePoint(
          Number.parseInt(value, 10)
        )
    )
    .replace(
      /&([a-zA-Z]+);/g,
      (match, name) =>
        Object.prototype.hasOwnProperty.call(
          entities,
          name
        )
          ? entities[name]
          : match
    );
}


function htmlToText(html = "") {
  return decodeHtmlEntities(
    String(html)
      .replace(
        /<!--[\s\S]*?-->/g,
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
        /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
        " "
      )
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<br\s*\/?>/gi,
        "\n"
      )
      .replace(
        /<\/(?:div|p|li|article|section|h1|h2|h3|h4|tr)>/gi,
        "\n"
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}


function normalizeText(value = "") {
  return String(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function escapeRegExp(value = "") {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


function unique(values = []) {
  return [
    ...new Set(
      values.filter(Boolean)
    )
  ];
}


/* =========================================================
   FECHA ESPAÑOLA
   ========================================================= */


function getSpainDateISO() {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          TIME_ZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    );

  const parts =
    formatter.formatToParts(
      new Date()
    );

  const values = {};

  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day"
    ) {
      values[part.type] =
        part.value;
    }
  }

  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );
}


/* =========================================================
   DESCARGA
   ========================================================= */


async function fetchPage(url) {
  const response =
    await fetch(
      url,
      {
        redirect:
          "follow",

        headers: {
          "user-agent":
            USER_AGENT,

          accept:
            "text/html,application/xhtml+xml," +
            "application/xml;q=0.9,*/*;q=0.8",

          "accept-language":
            "es-ES,es;q=0.9,en;q=0.6",

          "cache-control":
            "no-cache",

          pragma:
            "no-cache"
        },

        signal:
          AbortSignal.timeout(
            30000
          )
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    );
  }

  const html =
    await response.text();

  return {
    finalUrl:
      response.url,

    text:
      htmlToText(html),

    htmlLength:
      html.length
  };
}


async function fetchProgramGuide(
  program
) {
  const errors = [];

  for (
    const url
    of program.guideUrls
  ) {
    try {
      const page =
        await fetchPage(url);

      const normalizedPage =
        normalizeText(page.text);

      const normalizedTitle =
        normalizeText(program.title);

      if (
        normalizedPage.includes(
          normalizedTitle
        )
      ) {
        return page;
      }

      errors.push(
        `${url}: título no encontrado`
      );
    } catch (error) {
      errors.push(
        `${url}: ${error.message}`
      );
    }
  }

  throw new Error(
    errors.join(" | ")
  );
}


/* =========================================================
   HORAS

   Se buscan únicamente horas muy próximas al título.

   Formatos admitidos:

   13:10 Toros para todos
   13.30 Toros para todos
   13:30-14:20 Tendido Cero
   Grana y Oro 15:25
   ========================================================= */


function normalizeTime(
  hour,
  minute
) {
  const numericHour =
    Number(hour);

  const numericMinute =
    Number(minute);

  if (
    numericHour < 0 ||
    numericHour > 23 ||
    numericMinute < 0 ||
    numericMinute > 59
  ) {
    return "";
  }

  return (
    String(numericHour).padStart(2, "0") +
    ":" +
    String(numericMinute).padStart(2, "0")
  );
}


function timeToMinutes(time = "") {
  const match =
    String(time).match(
      /^(\d{2}):(\d{2})$/
    );

  if (!match) {
    return 9999;
  }

  return (
    Number(match[1]) * 60 +
    Number(match[2])
  );
}


function extractTimes(
  pageText,
  programTitle
) {
  const normalizedPage =
    normalizeText(pageText);

  const normalizedTitle =
    normalizeText(programTitle);

  const escapedTitle =
    escapeRegExp(
      normalizedTitle
    );

  const times = [];


  /*
    Hora situada antes del título:

    13:30 Tendido Cero
    13:30-14:20 Tendido Cero
  */

  const beforePattern =
    new RegExp(
      `(?:^|[^\\d])` +
      `([01]?\\d|2[0-3])[:.]([0-5]\\d)` +
      `(?:\\s*[-–—]\\s*` +
      `(?:[01]?\\d|2[0-3])[:.][0-5]\\d)?` +
      `\\s*${escapedTitle}`,
      "gi"
    );

  for (
    const match
    of normalizedPage.matchAll(
      beforePattern
    )
  ) {
    const time =
      normalizeTime(
        match[1],
        match[2]
      );

    if (time) {
      times.push(time);
    }
  }


  /*
    Hora situada después del título:

    Grana y Oro 15:25
    Tendido Cero, a las 13:30
  */

  const afterPattern =
    new RegExp(
      `${escapedTitle}` +
      `\\s*(?:,?\\s*a\\s+las\\s+)?` +
      `([01]?\\d|2[0-3])[:.]([0-5]\\d)`,
      "gi"
    );

  for (
    const match
    of normalizedPage.matchAll(
      afterPattern
    )
  ) {
    const time =
      normalizeTime(
        match[1],
        match[2]
      );

    if (time) {
      times.push(time);
    }
  }


  /*
    Comprobación adicional por contexto.

    Solo revisa 45 caracteres antes y después
    de cada aparición del título.
  */

  let searchFrom = 0;

  while (
    searchFrom <
    normalizedPage.length
  ) {
    const position =
      normalizedPage.indexOf(
        normalizedTitle,
        searchFrom
      );

    if (position === -1) {
      break;
    }

    const before =
      normalizedPage.slice(
        Math.max(
          0,
          position - 45
        ),
        position
      );

    const beforeMatch =
      before.match(
        /([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-–—]\s*(?:[01]?\d|2[0-3])[:.][0-5]\d)?\s*$/
      );

    if (beforeMatch) {
      const time =
        normalizeTime(
          beforeMatch[1],
          beforeMatch[2]
        );

      if (time) {
        times.push(time);
      }
    }

    const after =
      normalizedPage.slice(
        position +
          normalizedTitle.length,
        position +
          normalizedTitle.length +
          45
      );

    const afterMatch =
      after.match(
        /^\s*(?:,?\s*a\s+las\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)/
      );

    if (afterMatch) {
      const time =
        normalizeTime(
          afterMatch[1],
          afterMatch[2]
        );

      if (time) {
        times.push(time);
      }
    }

    searchFrom =
      position +
      normalizedTitle.length;
  }


  return unique(times).sort(
    (timeA, timeB) =>
      timeToMinutes(timeA) -
      timeToMinutes(timeB)
  );
}


/* =========================================================
   CREAR EVENTO
   ========================================================= */


function createEvent({
  program,
  date,
  time
}) {
  return {
    id:
      `${program.id}-${date}-${time.replace(":", "")}`,

    source:
      program.source,

    title:
      program.title,

    type:
      "Programa taurino",

    contentType:
      "programa",

    date,

    time,

    channel:
      program.channel,

    location:
      "Televisión",

    breeding:
      "",

    participants:
      [],

    sourceUrl:
      program.sourceUrl,

    eventUrl:
      program.eventUrl
  };
}


/* =========================================================
   PROCESAR PROGRAMA
   ========================================================= */


async function processProgram(
  program,
  date
) {
  console.log("");
  console.log(
    `Buscando ${program.title}...`
  );

  try {
    const page =
      await fetchProgramGuide(
        program
      );

    const times =
      extractTimes(
        page.text,
        program.title
      );

    console.log(
      `Página: ${page.finalUrl}`
    );

    console.log(
      `Tamaño HTML: ${page.htmlLength}`
    );

    if (!times.length) {
      console.log(
        `Título encontrado, pero sin hora: ${program.title}`
      );

      return {
        diagnostic: {
          program:
            program.title,

          source:
            program.source,

          finalUrl:
            page.finalUrl,

          present:
            true,

          times:
            [],

          eventsCreated:
            0,

          warning:
            "El título aparece en la guía, pero no se encontró una hora próxima."
        },

        events:
          []
      };
    }

    console.log(
      `Horas encontradas: ${times.join(", ")}`
    );

    return {
      diagnostic: {
        program:
          program.title,

        source:
          program.source,

        finalUrl:
          page.finalUrl,

        present:
          true,

        times,

        eventsCreated:
          times.length
      },

      events:
        times.map(
          time =>
            createEvent({
              program,
              date,
              time
            })
        )
    };
  } catch (error) {
    console.log(
      `No encontrado: ${program.title}`
    );

    console.log(
      error.message
    );

    return {
      diagnostic: {
        program:
          program.title,

        source:
          program.source,

        requestedUrls:
          program.guideUrls,

        present:
          false,

        times:
          [],

        eventsCreated:
          0,

        error:
          error.message
      },

      events:
        []
    };
  }
}


/* =========================================================
   ELIMINAR DUPLICADOS
   ========================================================= */


function deduplicateEvents(
  events
) {
  const map =
    new Map();

  for (const event of events) {
    const key =
      [
        event.date,
        event.time,
        normalizeText(event.title),
        normalizeText(event.channel)
      ].join("|");

    if (!map.has(key)) {
      map.set(
        key,
        event
      );
    }
  }

  return [
    ...map.values()
  ].sort(
    (eventA, eventB) =>
      eventA.date.localeCompare(
        eventB.date
      ) ||
      timeToMinutes(eventA.time) -
        timeToMinutes(eventB.time)
  );
}


/* =========================================================
   PRINCIPAL
   ========================================================= */


async function main() {
  console.log(
    "======================================"
  );

  console.log(
    "ALBERO TV — PROGRAMAS TAURINOS"
  );

  console.log(
    `Versión: ${SCRAPER_VERSION}`
  );

  console.log(
    "======================================"
  );

  const date =
    getSpainDateISO();

  console.log(
    `Fecha España: ${date}`
  );

  const diagnostics = [];
  const collectedEvents = [];

  for (
    const program
    of PROGRAMS
  ) {
    const result =
      await processProgram(
        program,
        date
      );

    diagnostics.push(
      result.diagnostic
    );

    collectedEvents.push(
      ...result.events
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          600
        )
    );
  }

  const events =
    deduplicateEvents(
      collectedEvents
    );

  const output = {
    scraperVersion:
      SCRAPER_VERSION,

    source:
      "Programas taurinos",

    updatedAt:
      new Date().toISOString(),

    timeZone:
      TIME_ZONE,

    date,

    checked:
      PROGRAMS.length,

    programsPresent:
      diagnostics.filter(
        item =>
          item.present
      ).length,

    programsWithTime:
      diagnostics.filter(
        item =>
          item.eventsCreated > 0
      ).length,

    emissionsFound:
      events.length,

    diagnostics,

    events
  };

  await fs.mkdir(
    path.dirname(
      OUTPUT_FILE
    ),
    {
      recursive:
        true
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
    "======================================"
  );

  console.log(
    "RESULTADO"
  );

  console.log(
    "======================================"
  );

  console.log(
    `Programas presentes: ${output.programsPresent}`
  );

  console.log(
    `Programas con hora: ${output.programsWithTime}`
  );

  console.log(
    `Emisiones creadas: ${output.emissionsFound}`
  );

  console.log(
    `Archivo: ${OUTPUT_FILE}`
  );
}


main().catch(error => {
  console.error(
    "ERROR FATAL:"
  );

  console.error(error);

  process.exitCode = 1;
});
