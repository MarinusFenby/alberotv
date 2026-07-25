import fs from "node:fs/promises";
import path from "node:path";


/* =========================================================
   ALBERO TV — SCRAPER DE CANAL SUR

   Este scraper:

   1. Busca publicaciones recientes de Canal Sur.
   2. Abre únicamente páginas oficiales de canalsur.es.
   3. Comprueba que el texto confirma una retransmisión.
   4. Extrae fecha, hora, localidad, festejo, ganadería
      y participantes cuando estén disponibles.
   5. Genera data/canalsur.json.

   No necesita instalar ninguna dependencia adicional.
   ========================================================= */


const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "data",
  "canalsur.json"
);


const GOOGLE_NEWS_RSS_URL =
  "https://news.google.com/rss/search?" +
  new URLSearchParams({
    q:
      'site:canalsur.es/rtva/comunicacion ' +
      '(toros OR corrida OR novillada OR rejones OR becerrada) ' +
      '("Canal Sur TV" OR "Canal Sur Televisión")',
    hl: "es",
    gl: "ES",
    ceid: "ES:es"
  }).toString();


const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://github.com/)";


const MAX_ARTICLES = 40;


/*
  Permitimos artículos recientes y también algunos
  artículos futuros encontrados en los resultados.

  La fecha definitiva del evento se comprueba después
  leyendo el contenido de cada artículo.
*/

const MAX_EVENT_AGE_DAYS = 7;
const MAX_EVENT_FUTURE_DAYS = 180;


/* =========================================================
   UTILIDADES GENERALES
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


function escapeRegExp(value = "") {
  return String(value)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function decodeHtmlEntities(value = "") {
  const namedEntities = {
    amp: "&",
    apos: "'",
    quot: '"',
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    laquo: "«",
    raquo: "»",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    ntilde: "ñ",
    Ntilde: "Ñ",
    uuml: "ü",
    Uuml: "Ü"
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
          namedEntities,
          entity
        )
          ? namedEntities[entity]
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
          /<\/h[1-6]>/gi,
          "\n"
        )
        .replace(
          /<[^>]+>/g,
          " "
        )
    )
  );
}


function unique(values = []) {
  return [
    ...new Set(
      values
        .map(value => normalizeWhitespace(value))
        .filter(Boolean)
    )
  ];
}


function toISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}


function createLocalDate(
  year,
  month,
  day
) {
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    12,
    0,
    0,
    0
  );

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return date;
}


function isDateInsideAllowedRange(date) {
  if (!(date instanceof Date)) {
    return false;
  }

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();

  today.setHours(
    12,
    0,
    0,
    0
  );

  const minimumDate =
    new Date(today);

  minimumDate.setDate(
    minimumDate.getDate() -
    MAX_EVENT_AGE_DAYS
  );

  const maximumDate =
    new Date(today);

  maximumDate.setDate(
    maximumDate.getDate() +
    MAX_EVENT_FUTURE_DAYS
  );

  return (
    date >= minimumDate &&
    date <= maximumDate
  );
}


/* =========================================================
   DESCARGAS
   ========================================================= */

async function fetchText(
  url,
  options = {}
) {
  const response =
    await fetch(url, {
      redirect: "follow",

      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml," +
          "application/xml;q=0.9,*/*;q=0.8",
        "accept-language":
          "es-ES,es;q=0.9,en;q=0.7",
        ...options.headers
      },

      signal:
        AbortSignal.timeout(
          options.timeout || 25000
        )
    });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} al descargar ${url}`
    );
  }

  return {
    text: await response.text(),
    finalUrl: response.url
  };
}


/* =========================================================
   LECTURA DEL RSS DE GOOGLE NEWS
   ========================================================= */

function extractXmlTag(
  xml,
  tagName
) {
  const expression =
    new RegExp(
      `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>` +
      `([\\s\\S]*?)` +
      `<\\/${escapeRegExp(tagName)}>`,
      "i"
    );

  const match =
    String(xml).match(expression);

  return match
    ? decodeHtmlEntities(
        match[1]
          .replace(
            /^<!\[CDATA\[([\s\S]*)\]\]>$/,
            "$1"
          )
      ).trim()
    : "";
}


function parseGoogleNewsRss(xml = "") {
  const items =
    String(xml).match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

  return items
    .map(itemXml => {
      return {
        title:
          extractXmlTag(
            itemXml,
            "title"
          ),

        link:
          extractXmlTag(
            itemXml,
            "link"
          ),

        publicationDate:
          extractXmlTag(
            itemXml,
            "pubDate"
          )
      };
    })
    .filter(
      item =>
        item.link &&
        item.title
    )
    .slice(
      0,
      MAX_ARTICLES
    );
}


/* =========================================================
   METADATOS DE LA PÁGINA
   ========================================================= */

function extractMetaContent(
  html,
  attributeName,
  attributeValue
) {
  const escapedName =
    escapeRegExp(attributeName);

  const escapedValue =
    escapeRegExp(attributeValue);

  const patterns = [
    new RegExp(
      `<meta\\b[^>]*` +
      `${escapedName}=["']${escapedValue}["']` +
      `[^>]*content=["']([^"']*)["']` +
      `[^>]*>`,
      "i"
    ),

    new RegExp(
      `<meta\\b[^>]*` +
      `content=["']([^"']*)["']` +
      `[^>]*${escapedName}=["']${escapedValue}["']` +
      `[^>]*>`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const match =
      String(html).match(pattern);

    if (match) {
      return normalizeWhitespace(
        decodeHtmlEntities(
          match[1]
        )
      );
    }
  }

  return "";
}


function extractPageTitle(html = "") {
  return (
    extractMetaContent(
      html,
      "property",
      "og:title"
    ) ||
    extractMetaContent(
      html,
      "name",
      "twitter:title"
    ) ||
    stripHtml(
      String(html).match(
        /<title\b[^>]*>([\s\S]*?)<\/title>/i
      )?.[1] || ""
    )
  );
}


function extractPageDescription(html = "") {
  return (
    extractMetaContent(
      html,
      "property",
      "og:description"
    ) ||
    extractMetaContent(
      html,
      "name",
      "description"
    ) ||
    extractMetaContent(
      html,
      "name",
      "twitter:description"
    )
  );
}


function extractCanonicalUrl(
  html,
  fallbackUrl
) {
  const match =
    String(html).match(
      /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
    ) ||
    String(html).match(
      /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i
    );

  return match
    ? decodeHtmlEntities(
        match[1]
      ).trim()
    : fallbackUrl;
}


/* =========================================================
   COMPROBAR QUE ES UNA RETRANSMISIÓN REAL
   ========================================================= */

function confirmsLiveBroadcast(text = "") {
  const normalized =
    normalizeText(text);

  const broadcastExpressions = [
    "canal sur television emite",
    "canal sur television emitira",
    "canal sur television retransmite",
    "canal sur television retransmitira",
    "canal sur tv emite",
    "canal sur tv emitira",
    "canal sur tv retransmite",
    "canal sur tv retransmitira",
    "canal sur televisara",
    "canal sur retransmite",
    "canal sur retransmitira",
    "se emitira en directo",
    "emite en directo",
    "emitira en directo",
    "retransmite en directo",
    "retransmitira en directo"
  ];

  const taurineExpressions = [
    "corrida de toros",
    "corrida mixta",
    "corrida de rejones",
    "novillada",
    "novillos",
    "becerrada",
    "festejo taurino",
    "toros desde",
    "ciclo de becerradas",
    "circuito de novilladas"
  ];

  const hasBroadcastConfirmation =
    broadcastExpressions.some(
      expression =>
        normalized.includes(expression)
    );

  const hasTaurineEvent =
    taurineExpressions.some(
      expression =>
        normalized.includes(expression)
    );

  return (
    hasBroadcastConfirmation &&
    hasTaurineEvent
  );
}


/* =========================================================
   EXTRAER FECHA
   ========================================================= */

const MONTHS = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12
};


function extractPublicationDate(html = "") {
  const candidates = [
    extractMetaContent(
      html,
      "property",
      "article:published_time"
    ),

    extractMetaContent(
      html,
      "name",
      "date"
    ),

    extractMetaContent(
      html,
      "name",
      "DC.date"
    )
  ].filter(Boolean);

  for (const candidate of candidates) {
    const date =
      new Date(candidate);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date;
    }
  }

  return null;
}


function extractExplicitSpanishDates(text = "") {
  const dates = [];

  const expression =
    /\b(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)?\s*,?\s*(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/gi;

  let match;

  while (
    (
      match =
        expression.exec(text)
    ) !== null
  ) {
    dates.push({
      day:
        Number(match[1]),

      month:
        MONTHS[
          normalizeText(match[2])
        ],

      year:
        match[3]
          ? Number(match[3])
          : null,

      index:
        match.index,

      original:
        match[0]
    });
  }

  return dates;
}


function chooseEventDate(
  text,
  publicationDate
) {
  const explicitDates =
    extractExplicitSpanishDates(text);

  const publicationYear =
    publicationDate
      ? publicationDate.getFullYear()
      : new Date().getFullYear();

  const candidates =
    explicitDates
      .map(candidate => {
        let year =
          candidate.year ||
          publicationYear;

        let date =
          createLocalDate(
            year,
            candidate.month,
            candidate.day
          );

        /*
          Cuando el artículo se publica al final de año
          y anuncia un festejo de enero, puede no indicar
          expresamente el año.
        */

        if (
          date &&
          publicationDate &&
          !candidate.year &&
          date <
            new Date(
              publicationDate.getTime() -
              45 * 24 * 60 * 60 * 1000
            )
        ) {
          year += 1;

          date =
            createLocalDate(
              year,
              candidate.month,
              candidate.day
            );
        }

        return {
          ...candidate,
          date
        };
      })
      .filter(
        candidate =>
          candidate.date &&
          isDateInsideAllowedRange(
            candidate.date
          )
      );

  if (!candidates.length) {
    return null;
  }

  /*
    Priorizamos las fechas que aparecen cerca
    de expresiones como "este sábado", "festejo",
    "emite" o "retransmite".
  */

  const scoredCandidates =
    candidates.map(candidate => {
      const start =
        Math.max(
          0,
          candidate.index - 160
        );

      const end =
        Math.min(
          text.length,
          candidate.index + 160
        );

      const context =
        normalizeText(
          text.slice(start, end)
        );

      let score = 0;

      if (
        context.includes("emite") ||
        context.includes("emitira")
      ) {
        score += 4;
      }

      if (
        context.includes("retransmite") ||
        context.includes("retransmitira")
      ) {
        score += 4;
      }

      if (
        context.includes("festejo") ||
        context.includes("corrida") ||
        context.includes("novillada") ||
        context.includes("becerrada")
      ) {
        score += 3;
      }

      if (
        context.includes("este sabado") ||
        context.includes("este domingo") ||
        context.includes("este viernes")
      ) {
        score += 2;
      }

      if (
        publicationDate &&
        candidate.date >=
          new Date(
            publicationDate.getFullYear(),
            publicationDate.getMonth(),
            publicationDate.getDate()
          )
      ) {
        score += 2;
      }

      return {
        ...candidate,
        score
      };
    });

  scoredCandidates.sort(
    (candidateA, candidateB) =>
      candidateB.score -
        candidateA.score ||
      candidateA.index -
        candidateB.index
  );

  return scoredCandidates[0].date;
}


/* =========================================================
   EXTRAER HORA
   ========================================================= */

function normalizeTime(
  hour,
  minute = "00"
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


function extractTime(text = "") {
  const patterns = [
    /(?:canal sur(?: televisión| tv)?\s*\|\s*)?(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)?\s*,?\s*(\d{1,2})[:.](\d{2})\s*h(?:oras?)?\b/i,

    /(?:a partir de las|desde las|a las)\s+(\d{1,2})[:.](\d{2})\s*(?:h|horas?)?\b/i,

    /\b(\d{1,2})[:.](\d{2})\s*(?:h|horas?)\b/i
  ];

  for (const pattern of patterns) {
    const match =
      String(text).match(pattern);

    if (match) {
      return normalizeTime(
        match[1],
        match[2]
      );
    }
  }

  return "";
}


/* =========================================================
   EXTRAER TIPO DE FESTEJO
   ========================================================= */

function extractEventType(text = "") {
  const normalized =
    normalizeText(text);

  if (
    normalized.includes(
      "corrida de rejones"
    ) ||
    normalized.includes(
      "festejo de rejones"
    )
  ) {
    return "Corrida de rejones";
  }

  if (
    normalized.includes(
      "novillada con picadores"
    ) ||
    normalized.includes(
      "circuito de novilladas de andalucia"
    )
  ) {
    return "Novillada con picadores";
  }

  if (
    normalized.includes(
      "novillada sin picadores"
    ) ||
    normalized.includes(
      "novillada de promocion"
    ) ||
    normalized.includes(
      "ciclo de novilladas sin picadores"
    )
  ) {
    return "Novillada sin picadores";
  }

  if (
    normalized.includes(
      "clase practica"
    ) ||
    normalized.includes(
      "ciclo de becerradas"
    )
  ) {
    return "Clase práctica";
  }

  if (
    normalized.includes(
      "becerrada"
    )
  ) {
    return "Becerrada";
  }

  if (
    normalized.includes(
      "corrida mixta"
    )
  ) {
    return "Corrida mixta";
  }

  if (
    normalized.includes(
      "festival taurino"
    ) ||
    normalized.includes(
      "festival benefico"
    )
  ) {
    return "Festival taurino";
  }

  if (
    normalized.includes(
      "novillada"
    )
  ) {
    return "Novillada";
  }

  if (
    normalized.includes(
      "corrida de toros"
    ) ||
    normalized.includes(
      "toros desde"
    )
  ) {
    return "Corrida de toros";
  }

  return "Festejo taurino";
}


/* =========================================================
   EXTRAER LOCALIDAD
   ========================================================= */

function cleanLocation(value = "") {
  return normalizeWhitespace(
    String(value)
      .replace(
        /^[\s,:;–—-]+/,
        ""
      )
      .replace(
        /[\s,:;–—-]+$/,
        ""
      )
      .replace(
        /\b(?:este|esta)\s+(?:sábado|sabado|domingo|viernes|jueves|miércoles|miercoles|martes|lunes)\b.*$/i,
        ""
      )
      .replace(
        /\b(?:para|con|donde|que)\b.*$/i,
        ""
      )
  );
}


function extractLocation(
  title,
  text
) {
  const titlePatterns = [
    /\bdesde\s+(?:la\s+plaza\s+de\s+toros\s+de\s+)?([^|,:;]+?)(?:\s+con\b|\s+para\b|\s+este\b|\s+el\b|$)/i,

    /\btoros\s+desde\s+([^|,:;]+?)(?:\s+con\b|\s+para\b|\s+este\b|\s+el\b|$)/i,

    /\bnovillada\s+(?:de\s+promoción\s+)?desde\s+([^|,:;]+?)(?:\s+con\b|\s+para\b|\s+este\b|\s+el\b|$)/i
  ];

  for (const pattern of titlePatterns) {
    const match =
      String(title).match(pattern);

    if (match) {
      const location =
        cleanLocation(match[1]);

      if (location.length >= 2) {
        return location;
      }
    }
  }

  const bodyPatterns = [
    /(?:la\s+)?plaza\s+de\s+toros\s+de\s+([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s-]{2,60}?)(?:\s*\(|\s+acoge\b|\s+será\b|\s+sera\b|,|\.)/,

    /(?:desde|en)\s+([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s-]{2,60}?)\s+(?:este|el próximo|el proximo)\s+(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)/
  ];

  for (const pattern of bodyPatterns) {
    const match =
      String(text).match(pattern);

    if (match) {
      const location =
        cleanLocation(match[1]);

      if (location.length >= 2) {
        return location;
      }
    }
  }

  return "";
}


/* =========================================================
   EXTRAER GANADERÍA
   ========================================================= */

function cleanBreeding(value = "") {
  return normalizeWhitespace(
    String(value)
      .replace(
        /^(?:la\s+)?ganadería\s+de\s+/i,
        ""
      )
      .replace(
        /^(?:toros|novillos|reses)\s+de\s+/i,
        ""
      )
      .replace(
        /\s+(?:para|que|y estarán|y estaran)\b.*$/i,
        ""
      )
      .replace(
        /[.,;:]+$/,
        ""
      )
  );
}


function extractBreeding(text = "") {
  const patterns = [
    /(?:se\s+lidiarán|se\s+lidiaran|lidiarán|lidiaran)\s+(?:seis\s+)?(?:toros|novillos|reses)\s+de(?:\s+la\s+ganadería\s+de)?\s+([^.;]{2,80}?)(?=\s+para\b|[.;])/i,

    /(?:toros|novillos|reses)\s+de\s+[«"]?([^»".;]{2,80})[»"]?\s+para\b/i,

    /ganadería\s+de\s+[«"]?([^»".;]{2,80})[»"]?(?=\s+para\b|[.;])/i
  ];

  for (const pattern of patterns) {
    const match =
      String(text).match(pattern);

    if (match) {
      const breeding =
        cleanBreeding(match[1]);

      if (
        breeding.length >= 2 &&
        breeding.length <= 80
      ) {
        return breeding;
      }
    }
  }

  return "";
}


/* =========================================================
   EXTRAER PARTICIPANTES
   ========================================================= */

function cleanParticipant(value = "") {
  return normalizeWhitespace(
    String(value)
      .replace(
        /^[\s,:;–—-]+/,
        ""
      )
      .replace(
        /[\s,:;–—-]+$/,
        ""
      )
      .replace(
        /^(?:los\s+diestros|los\s+novilleros|para)\s+/i,
        ""
      )
      .replace(
        /\s+(?:que|quienes|buscarán|buscaran|lidiarán|lidiaran)\b.*$/i,
        ""
      )
  );
}


function splitParticipants(value = "") {
  let participantText =
    normalizeWhitespace(value)
      .replace(
        /\s+y\s+/gi,
        ", "
      )
      .replace(
        /\s+e\s+/gi,
        ", "
      )
      .replace(
        /\s*;\s*/g,
        ", "
      );

  return unique(
    participantText
      .split(",")
      .map(cleanParticipant)
      .filter(
        participant =>
          participant.length >= 3 &&
          participant.length <= 55 &&
          !normalizeText(
            participant
          ).includes(
            "ganaderia"
          )
      )
  ).slice(
    0,
    8
  );
}


function extractParticipants(text = "") {
  const patterns = [
    /(?:toros|novillos|reses)\s+de\s+[^.;]{2,100}?\s+para\s+([^.;]{5,240})[.;]/i,

    /(?:el\s+cartel\s+(?:lo\s+)?componen|cartel\s+formado\s+por|cartel\s+compuesto\s+por)\s+([^.;]{5,240})[.;]/i,

    /(?:para\s+los\s+diestros|para\s+los\s+novilleros)\s+([^.;]{5,240})[.;]/i
  ];

  for (const pattern of patterns) {
    const match =
      String(text).match(pattern);

    if (match) {
      const participants =
        splitParticipants(
          match[1]
        );

      if (participants.length) {
        return participants;
      }
    }
  }

  return [];
}


/* =========================================================
   CREAR EVENTO
   ========================================================= */

function buildEvent({
  html,
  finalUrl,
  rssTitle
}) {
  const title =
    extractPageTitle(html) ||
    rssTitle ||
    "";

  const description =
    extractPageDescription(html);

  const pageText =
    stripHtml(html);

  const combinedText =
    normalizeWhitespace(
      [
        title,
        description,
        pageText
      ].join(" ")
    );

  if (
    !confirmsLiveBroadcast(
      combinedText
    )
  ) {
    return null;
  }

  const publicationDate =
    extractPublicationDate(html);

  const eventDate =
    chooseEventDate(
      combinedText,
      publicationDate
    );

  if (!eventDate) {
    return null;
  }

  const time =
    extractTime(
      combinedText
    );

  const location =
    extractLocation(
      title,
      combinedText
    );

  const type =
    extractEventType(
      combinedText
    );

  const breeding =
    extractBreeding(
      combinedText
    );

  const participants =
    extractParticipants(
      combinedText
    );

  const sourceUrl =
    extractCanonicalUrl(
      html,
      finalUrl
    );

  return {
    id:
      [
        "canalsur",
        toISODate(eventDate),
        normalizeText(location || title)
          .replace(
            /[^a-z0-9]+/g,
            "-"
          )
          .replace(
            /^-+|-+$/g,
            ""
          )
          .slice(
            0,
            70
          )
      ].join("-"),

    source:
      "Canal Sur",

    date:
      toISODate(eventDate),

    time:
      time ||
      "Hora por confirmar",

    channel:
      "Canal Sur Televisión",

    location:
      location ||
      "Localidad por confirmar",

    type,

    breeding,

    participants,

    title,

    sourceUrl,

    eventUrl:
      "https://www.canalsurmas.es/directo/canal-sur-tv/"
  };
}


/* =========================================================
   EVITAR DUPLICADOS
   ========================================================= */

function eventDeduplicationKey(event) {
  return [
    event.date,
    normalizeText(event.time),
    normalizeText(event.location),
    normalizeText(event.type)
  ].join("|");
}


function deduplicateEvents(events = []) {
  const eventsByKey =
    new Map();

  for (const event of events) {
    const key =
      eventDeduplicationKey(
        event
      );

    const existing =
      eventsByKey.get(key);

    if (!existing) {
      eventsByKey.set(
        key,
        event
      );

      continue;
    }

    /*
      Si encontramos dos versiones del mismo evento,
      conservamos la que tenga más información.
    */

    const existingScore =
      Number(Boolean(existing.breeding)) +
      existing.participants.length +
      Number(
        existing.time !==
          "Hora por confirmar"
      ) +
      Number(
        existing.location !==
          "Localidad por confirmar"
      );

    const newScore =
      Number(Boolean(event.breeding)) +
      event.participants.length +
      Number(
        event.time !==
          "Hora por confirmar"
      ) +
      Number(
        event.location !==
          "Localidad por confirmar"
      );

    if (newScore > existingScore) {
      eventsByKey.set(
        key,
        event
      );
    }
  }

  return [
    ...eventsByKey.values()
  ].sort(
    (eventA, eventB) =>
      eventA.date.localeCompare(
        eventB.date
      ) ||
      eventA.time.localeCompare(
        eventB.time
      )
  );
}


/* =========================================================
   PROCESAR ARTÍCULOS
   ========================================================= */

async function processArticle(
  item,
  index,
  total
) {
  console.log(
    `[${index + 1}/${total}] Revisando: ${item.title}`
  );

  try {
    const {
      text: html,
      finalUrl
    } =
      await fetchText(
        item.link
      );

    const parsedUrl =
      new URL(finalUrl);

    if (
      !parsedUrl.hostname.endsWith(
        "canalsur.es"
      )
    ) {
      console.log(
        `  Ignorado: dominio no oficial (${parsedUrl.hostname})`
      );

      return null;
    }

    if (
      !parsedUrl.pathname.includes(
        "/rtva/comunicacion/"
      )
    ) {
      console.log(
        "  Ignorado: no es una comunicación oficial de RTVA"
      );

      return null;
    }

    const event =
      buildEvent({
        html,
        finalUrl,
        rssTitle:
          item.title
      });

    if (!event) {
      console.log(
        "  Ignorado: no se confirmó una retransmisión futura"
      );

      return null;
    }

    console.log(
      `  Añadido: ${event.date} · ${event.time} · ${event.location}`
    );

    return event;
  } catch (error) {
    console.warn(
      `  Error leyendo el artículo: ${error.message}`
    );

    return null;
  }
}


/* =========================================================
   FUNCIÓN PRINCIPAL
   ========================================================= */

async function main() {
  console.log(
    "AlberoTV — Canal Sur"
  );

  console.log(
    "Buscando comunicaciones oficiales..."
  );

  const {
    text: rssXml
  } =
    await fetchText(
      GOOGLE_NEWS_RSS_URL,
      {
        headers: {
          accept:
            "application/rss+xml," +
            "application/xml;q=0.9," +
            "text/xml;q=0.8,*/*;q=0.7"
        }
      }
    );

  const rssItems =
    parseGoogleNewsRss(
      rssXml
    );

  console.log(
    `${rssItems.length} posibles artículos encontrados`
  );

  const events = [];

  /*
    Los procesamos uno a uno para evitar bombardear
    tanto Google News como Canal Sur con peticiones.
  */

  for (
    let index = 0;
    index < rssItems.length;
    index++
  ) {
    const event =
      await processArticle(
        rssItems[index],
        index,
        rssItems.length
      );

    if (event) {
      events.push(event);
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          300
        )
    );
  }

  const finalEvents =
    deduplicateEvents(
      events
    );

  const output = {
    source:
      "Canal Sur",

    updatedAt:
      new Date().toISOString(),

    events:
      finalEvents
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
    `Finalizado: ${finalEvents.length} eventos guardados`
  );
  console.log(
    `Archivo: ${OUTPUT_FILE}`
  );

  if (!finalEvents.length) {
    console.warn(
      "Aviso: no se encontraron retransmisiones futuras de Canal Sur."
    );

    console.warn(
      "Esto no implica necesariamente un error; puede no haber emisiones anunciadas actualmente."
    );
  }
}


main().catch(error => {
  console.error("");
  console.error(
    "Error fatal en el scraper de Canal Sur:"
  );
  console.error(error);

  process.exitCode = 1;
});
