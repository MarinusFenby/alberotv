import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_FILE = path.resolve("data/cmm.json");
const BASE_URL = "https://www.cmmedia.es";
const INDEX_URLS = [
  `${BASE_URL}/tv/toros`,
  `${BASE_URL}/play/toros`,
  ...Array.from({ length: 10 }, (_, i) => `${BASE_URL}/tv/toros/${i + 2}`),
  ...Array.from({ length: 6 }, (_, i) => `${BASE_URL}/play/toros/${i + 2}`)
];

const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)";
const MAX_DETAIL_PAGES = 220;
const REQUEST_DELAY_MS = 100;
const PAST_DAYS = 7;
const FUTURE_DAYS = 240;

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12
};

const DAY_NAMES =
  "(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decodeHtml(value = "") {
  const named = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
    ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü"
  };

  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(parseInt(n, 10))
    )
    .replace(/&([a-z]+);/gi, (all, key) => named[key] ?? all);
}

function clean(value = "") {
  return decodeHtml(String(value))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plain(value = "") {
  return clean(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalized(value = "") {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function absoluteUrl(value, base = BASE_URL) {
  try {
    return new URL(decodeHtml(value), base).href.split("#")[0];
  } catch {
    return "";
  }
}

async function fetchPage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      "accept-language": "es-ES,es;q=0.9",
      accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  return { html: await response.text(), url: response.url || url };
}

function isDetailUrl(url) {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    return (
      /^\/(?:tv|play)\/toros\/.+\.html$/i.test(pathname) &&
      !/user-descargas\.html$/i.test(pathname)
    );
  } catch {
    return false;
  }
}

function extractLinks(html, pageUrl) {
  const links = [];

  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const url = absoluteUrl(match[1], pageUrl);
    if (isDetailUrl(url)) links.push(url);
  }

  return unique(links);
}

function meta(html, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escaped}["']`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1];
    if (found) return clean(found);
  }

  return "";
}

function titleFromHtml(html) {
  return (
    meta(html, "property", "og:title") ||
    plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") ||
    plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  )
    .replace(/\s*[-–|]\s*Castilla-La Mancha Media.*$/i, "")
    .trim();
}

function canonicalFromHtml(html, fallback) {
  const value =
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    )?.[1] ||
    html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
    )?.[1];

  return absoluteUrl(value || fallback, fallback);
}

function publishedDate(html) {
  const values = [
    meta(html, "property", "article:published_time"),
    meta(html, "name", "date"),
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1],
    html.match(/\b(\d{2}\.\d{2}\.20\d{2})\s+\d{1,2}:\d{2}\b/)?.[1]
  ].filter(Boolean);

  for (const value of values) {
    const european = value.match(/^(\d{2})\.(\d{2})\.(20\d{2})/);
    if (european) {
      return new Date(
        Number(european[3]),
        Number(european[2]) - 1,
        Number(european[1]),
        12
      );
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function articleHtml(html) {
  return (
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    html.match(
      /<(?:div|section)\b[^>]+class=["'][^"']*(?:article-body|article__body|entry-content|content-body|cuerpo|texto)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i
    )?.[1] ||
    html
  );
}

function meaningfulBlocks(html) {
  const source = articleHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  const blocks = [];

  for (const match of source.matchAll(
    /<(h2|h3|h4|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi
  )) {
    const type = match[1].toLowerCase();
    const text = plain(match[2]);

    if (
      text.length >= 8 &&
      text.length <= 1400 &&
      !/^(facebook|twitter|linkedin|enviar por email|whatsapp|telegram|últimas noticias|mira también|quitar alertas)/i.test(
        text
      )
    ) {
      blocks.push({ type, text });
    }
  }

  return blocks;
}

function createDate(year, month, day) {
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

function isoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function allowedDate(date) {
  if (!date || Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const min = new Date(today);
  min.setDate(min.getDate() - PAST_DAYS);

  const max = new Date(today);
  max.setDate(max.getDate() + FUTURE_DAYS);

  return date >= min && date <= max;
}

function dateMentions(text, fallbackYear) {
  const result = [];
  const source = normalized(text);

  for (const match of source.matchAll(
    /\b([0-3]?\d)[\/.-]([01]?\d)[\/.-](20\d{2})\b/g
  )) {
    const date = createDate(match[3], match[2], match[1]);
    if (date) result.push({ date, index: match.index, raw: match[0] });
  }

  for (const match of source.matchAll(
    new RegExp(
      `\\b(?:${DAY_NAMES}[,\\s]*)?([0-3]?\\d)\\s+de\\s+` +
        `(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)` +
        `(?:\\s+de\\s+(20\\d{2}))?\\b`,
      "gi"
    )
  )) {
    const year = Number(match[3] || fallbackYear);
    const date = createDate(year, MONTHS[match[2]], match[1]);
    if (date) result.push({ date, index: match.index, raw: match[0] });
  }

  return result.sort((a, b) => a.index - b.index);
}

function timeFrom(text) {
  const source = normalized(text);
  const patterns = [
    /\b(?:a\s+las?|desde\s+las?|a\s+partir\s+de\s+las?)\s+([01]?\d|2[0-3])[:.h]([0-5]\d)\b/,
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:h|horas?)\b/,
    /\b([01]?\d|2[0-3])h([0-5]\d)\b/
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  }

  return null;
}

function typeFrom(text) {
  const value = normalized(text);
  if (/concurso\s+de\s+recortadores|recortadores|recortes/.test(value))
    return "Concurso de recortadores";
  if (/corrida\s+mixta/.test(value)) return "Corrida mixta";
  if (/rejones|rejoneo/.test(value)) return "Rejones";
  if (/novillada\s+sin\s+picadores/.test(value))
    return "Novillada sin picadores";
  if (/novillada\s+con\s+picadores/.test(value))
    return "Novillada con picadores";
  if (/novillada/.test(value)) return "Novillada";
  if (/corrida\s+de\s+toros|corrida/.test(value))
    return "Corrida de toros";
  if (/festival/.test(value)) return "Festival taurino";
  if (/becerrada/.test(value)) return "Becerrada";
  return "Festejo taurino";
}

function cleanLocation(value) {
  return clean(value)
    .replace(/^la\s+plaza\s+de\s+toros\s+(?:de\s+)?/i, "")
    .replace(/^plaza\s+de\s+toros\s+(?:de\s+)?/i, "")
    .replace(/^la\s+localidad\s+(?:toledana|albaceteña|ciudadrealeña|conquense|guadalajareña)\s+de\s+/i, "")
    .replace(/^la\s+localidad\s+de\s+/i, "")
    .replace(/\s+(?:con|para|ante|donde|que)\s+.+$/i, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function locationFrom(text) {
  const patterns = [
    /\bdesde\s+(?:la\s+plaza\s+de\s+toros\s+(?:de\s+)?)?([^.;\n]+?)(?=\s+(?:a\s+las|con|para|ante|donde|el\s+(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo))|[.;\n]|$)/i,
    /\ben\s+(?:la\s+plaza\s+de\s+toros\s+(?:de\s+)?)?([^.;\n]+?)(?=\s+(?:a\s+las|con|para|ante|donde)|[.;\n]|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1];
    const value = cleanLocation(match || "");
    if (
      value.length >= 2 &&
      value.length <= 80 &&
      !/\by\b.+\b(?:corrida|novillada|rejones|toros)\b/i.test(value) &&
      !/televisi[oó]n|playtoros|castilla-la mancha media/i.test(value)
    ) {
      return value;
    }
  }

  return "";
}

function breedingFrom(text) {
  const patterns = [
    /\b(?:toros|novillos|reses)\s+de\s+(?:la\s+ganader[ií]a\s+)?([A-ZÁÉÍÓÚÑ][^.;\n]{2,90}?)(?=\s+(?:para|que|con)|[.;\n]|$)/i,
    /\bganader[ií]a\s+(?:de\s+)?([A-ZÁÉÍÓÚÑ][^.;\n]{2,90}?)(?=\s+(?:para|que|con)|[.;\n]|$)/i,
    /\bante\s+(?:toros|novillos|reses)\s+de\s+([A-ZÁÉÍÓÚÑ][^.;\n]{2,90}?)(?=[.;\n]|$)/i
  ];

  for (const pattern of patterns) {
    const value = clean(text.match(pattern)?.[1] || "")
      .replace(/\s+y\s+sobreros.*$/i, "")
      .trim();

    if (
      value &&
      value.length <= 100 &&
      !/este fin de semana|televisi[oó]n|programaci[oó]n|comentario|responder|me gusta/i.test(
        value
      )
    ) {
      return value;
    }
  }

  return "";
}

function splitNames(value) {
  return value
    .replace(/\s+(?:ante|frente\s+a)\s+(?:toros|novillos|reses).*$/i, "")
    .split(/\s*,\s*|\s+ y \s+/i)
    .map(name =>
      clean(name)
        .replace(/^(?:los\s+)?(?:matadores|toreros|novilleros|rejoneadores|diestros)\s*[:\-]?\s*/i, "")
        .replace(/[.;:]+$/g, "")
        .trim()
    )
    .filter(name =>
      name.length >= 3 &&
      name.length <= 55 &&
      !/ganader[ií]a|toros?|novillos?|directo|televisi[oó]n|playtoros|plaza|hora/i.test(name)
    );
}

function participantsFrom(text) {
  const names = [];
  const patterns = [
    /\b(?:para|con)\s+([A-ZÁÉÍÓÚÑ][^.;\n]{4,220}?)(?=\s+(?:ante|frente\s+a)\s+(?:toros|novillos|reses)|[.;\n]|$)/g,
    /\b(?:actuarán|actuaran|torearán|torearan|participarán|participaran)\s+([^.;\n]+)/gi,
    /\bcartel\s+(?:formado|compuesto|integrado)\s+por\s+([^.;\n]+)/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      names.push(...splitNames(match[1]));
    }
  }

  return unique(names).slice(0, 8);
}

function imageFromHtml(html, pageUrl) {
  const value = meta(html, "property", "og:image");
  return value ? absoluteUrl(value, pageUrl) : null;
}

function buildSegments(blocks, fallbackYear) {
  const segments = [];

  /*
    Cada encabezado abre una sección. Los párrafos siguientes pertenecen a ella.
    Además, cualquier bloque que contenga una fecha completa puede iniciar un evento.
  */
  let currentHeading = "";

  for (const block of blocks) {
    if (/^h[2-4]$/.test(block.type)) {
      currentHeading = block.text;
    }

    const combined = currentHeading && currentHeading !== block.text
      ? `${currentHeading}\n${block.text}`
      : block.text;

    const dates = dateMentions(combined, fallbackYear);

    if (!dates.length) continue;

    /*
      Si el mismo bloque contiene varias fechas, lo dividimos por la posición
      de cada fecha y damos a cada tramo su propio contexto.
    */
    const source = combined;
    const normalizedSource = normalized(source);

    for (let i = 0; i < dates.length; i++) {
      const start = Math.max(0, dates[i].index - 90);
      const end =
        i + 1 < dates.length
          ? Math.max(start, dates[i + 1].index - 1)
          : normalizedSource.length;

      const excerpt = normalizedSource.slice(start, end);
      const originalApprox = source.slice(
        Math.max(0, Math.min(start, source.length)),
        Math.max(0, Math.min(end + 260, source.length))
      );

      segments.push({
        date: dates[i].date,
        text: clean(`${currentHeading}\n${block.text}\n${originalApprox}`),
        excerpt
      });
    }
  }

  return segments;
}

function inferYear(published) {
  return published?.getFullYear() || new Date().getFullYear();
}

function segmentToEvent(segment, page, html) {
  if (!allowedDate(segment.date)) return null;

  const text = segment.text;
  const location = locationFrom(text);
  if (!location) return null;

  const type = typeFrom(text);

  const event = {
    id: null,
    source: "CMM",
    date: isoDate(segment.date),
    time: timeFrom(text),
    channel: "CMM",
    location,
    type,
    contentType: "festejo",
    breeding: breedingFrom(text),
    participants: participantsFrom(text),
    name: `${type} desde ${location}`,
    title: page.title,
    image: imageFromHtml(html, page.url),
    eventUrl: page.url,
    sourceUrl: page.url
  };

  const slug = normalized(`${event.date}-${location}-${type}`)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  event.id = `cmm-${slug}`;
  return event;
}

function sameEvent(a, b) {
  if (a.date !== b.date) return false;

  const x = normalized(a.location).replace(/\b(?:toledo|albacete|cuenca|guadalajara|ciudad real)\b/g, "").trim();
  const y = normalized(b.location).replace(/\b(?:toledo|albacete|cuenca|guadalajara|ciudad real)\b/g, "").trim();

  return x === y || x.includes(y) || y.includes(x);
}

function eventQuality(event) {
  return (
    (event.time ? 2 : 0) +
    (event.breeding ? 2 : 0) +
    Math.min(event.participants.length, 3) +
    (event.type !== "Festejo taurino" ? 1 : 0)
  );
}

function mergeEvents(events) {
  const output = [];

  for (const event of events.sort((a, b) => eventQuality(b) - eventQuality(a))) {
    const existing = output.find(item => sameEvent(item, event));

    if (!existing) {
      output.push({ ...event });
      continue;
    }

    existing.time ||= event.time;
    existing.breeding ||= event.breeding;
    existing.image ||= event.image;

    if (event.participants.length > existing.participants.length) {
      existing.participants = event.participants;
    }

    if (
      existing.type === "Festejo taurino" &&
      event.type !== "Festejo taurino"
    ) {
      existing.type = event.type;
    }
  }

  return output.sort((a, b) =>
    `${a.date} ${a.time || "99:99"}`.localeCompare(
      `${b.date} ${b.time || "99:99"}`
    )
  );
}

function parseDetailPage(html, url) {
  const page = {
    url: canonicalFromHtml(html, url),
    title: titleFromHtml(html),
    published: publishedDate(html)
  };

  /*
    Regla crítica: una noticia de 2024 no puede convertirse en programación 2026.
    Las fechas sin año heredan el año real de publicación del artículo.
  */
  const fallbackYear = inferYear(page.published);
  const blocks = meaningfulBlocks(html);
  const segments = buildSegments(blocks, fallbackYear);

  return segments
    .map(segment => segmentToEvent(segment, page, html))
    .filter(Boolean);
}

async function discover() {
  const urls = [];
  const errors = [];

  for (const indexUrl of INDEX_URLS) {
    try {
      const page = await fetchPage(indexUrl);
      urls.push(...extractLinks(page.html, page.url));
    } catch (error) {
      errors.push({
        phase: "discover",
        url: indexUrl,
        error: error.message
      });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return {
    urls: unique(urls).slice(0, MAX_DETAIL_PAGES),
    errors
  };
}

async function main() {
  console.log("AlberoTV — scraper oficial CMM por eventos");

  const discovery = await discover();
  const events = [];
  const errors = [...discovery.errors];

  console.log(`${discovery.urls.length} artículos oficiales encontrados`);

  for (let i = 0; i < discovery.urls.length; i++) {
    const url = discovery.urls[i];

    try {
      const page = await fetchPage(url);
      events.push(...parseDetailPage(page.html, page.url));
    } catch (error) {
      errors.push({
        phase: "detail",
        url,
        error: error.message
      });
    }

    if ((i + 1) % 20 === 0) {
      console.log(`Procesados ${i + 1}/${discovery.urls.length}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const finalEvents = mergeEvents(events);

  const output = {
    source: "CMM",
    updatedAt: new Date().toISOString(),
    eventCount: finalEvents.length,
    checkedPages: discovery.urls.length,
    discoveryPages: INDEX_URLS.length,
    errorCount: errors.length,
    events: finalEvents,
    errors: errors.slice(0, 20)
  };

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`CMM: ${finalEvents.length} eventos válidos`);
  console.log(`Salida: ${OUTPUT_FILE}`);
}

main().catch(error => {
  console.error("Error actualizando CMM:");
  console.error(error);
  process.exit(1);
});
