import fs from "node:fs/promises";
import path from "node:path";

/*
  ALBEROTV — SCRAPER OFICIAL DE CMM

  Fuente principal:
    https://www.cmmedia.es/tv/toros

  Fuente complementaria:
    https://www.cmmedia.es/play/toros

  El scraper:
  - recorre directamente las páginas taurinas oficiales de CMM;
  - descubre artículos y fichas de retransmisiones;
  - abre cada ficha oficial;
  - extrae fecha, hora, localidad, festejo, ganadería y participantes;
  - conserva solo emisiones recientes o futuras;
  - genera data/cmm.json;
  - no necesita instalar dependencias.
*/

const OUTPUT_FILE = path.resolve(process.cwd(), "data", "cmm.json");

const BASE_URL = "https://www.cmmedia.es";
const START_URLS = [
  `${BASE_URL}/tv/toros`,
  `${BASE_URL}/play/toros`,
  ...Array.from({ length: 8 }, (_, index) => `${BASE_URL}/tv/toros/${index + 2}`),
  ...Array.from({ length: 6 }, (_, index) => `${BASE_URL}/play/toros/${index + 2}`)
];

const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)";

const MAX_DETAIL_PAGES = 180;
const MAX_PAST_DAYS = 7;
const MAX_FUTURE_DAYS = 240;
const REQUEST_DELAY_MS = 120;

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

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function normalizeWhitespace(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(value = "") {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function decodeHtmlEntities(value = "") {
  const entities = {
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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&([a-zA-Z]+);/g, (match, entity) =>
      Object.prototype.hasOwnProperty.call(entities, entity)
        ? entities[entity]
        : match
    );
}

function stripHtmlKeepingLines(html = "") {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|li|h[1-6]|article|section|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
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

function absoluteUrl(value, baseUrl = BASE_URL) {
  if (!value) return "";

  try {
    return new URL(decodeHtmlEntities(value), baseUrl).href;
  } catch {
    return "";
  }
}

function isOfficialCmmUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === "cmmedia.es";
  } catch {
    return false;
  }
}

function isTaurineDetailUrl(url = "") {
  if (!isOfficialCmmUrl(url)) return false;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "");

    if (!/^\/(?:tv|play)\/toros\//i.test(pathname)) return false;
    if (/\/toros\/\d+$/i.test(pathname)) return false;
    if (/\/toros\/(?:directo|programacion|videos?)$/i.test(pathname)) return false;

    return pathname.endsWith(".html");
  } catch {
    return false;
  }
}

function extractLinks(html = "", pageUrl = BASE_URL) {
  const links = [];

  for (const match of String(html).matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi
  )) {
    const url = absoluteUrl(match[1], pageUrl);
    if (isTaurineDetailUrl(url)) links.push(url);
  }

  /*
    Algunas páginas incluyen enlaces dentro de JSON incrustado.
    Esta segunda lectura evita depender de una clase CSS concreta.
  */
  for (const match of String(html).matchAll(
    /["'](?:url|href)["']\s*:\s*["']([^"']+\/(?:tv|play)\/toros\/[^"']+\.html[^"']*)["']/gi
  )) {
    const url = absoluteUrl(match[1].replace(/\\\//g, "/"), pageUrl);
    if (isTaurineDetailUrl(url)) links.push(url);
  }

  return unique(links.map(url => url.split("#")[0]));
}

async function fetchPage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "es-ES,es;q=0.9"
    },
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  return {
    html: await response.text(),
    finalUrl: response.url || url
  };
}

function extractMetaContent(html = "", attribute, value) {
  const patterns = [
    new RegExp(
      `<meta[^>]+${attribute}=["']${value}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${value}["']`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern)?.[1];
    if (match) return normalizeWhitespace(decodeHtmlEntities(match));
  }

  return "";
}

function extractCanonicalUrl(html = "", fallbackUrl = "") {
  const match =
    String(html).match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    )?.[1] ||
    String(html).match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
    )?.[1];

  return absoluteUrl(match, fallbackUrl) || fallbackUrl;
}

function extractTitle(html = "") {
  const ogTitle = extractMetaContent(html, "property", "og:title");
  if (ogTitle) return ogTitle.replace(/\s*\|\s*CMM.*$/i, "").trim();

  const heading = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (heading) return stripHtmlKeepingLines(heading);

  const pageTitle = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripHtmlKeepingLines(pageTitle || "")
    .replace(/\s*\|\s*CMM.*$/i, "")
    .trim();
}

function extractDescription(html = "") {
  return (
    extractMetaContent(html, "property", "og:description") ||
    extractMetaContent(html, "name", "description")
  );
}

function extractImage(html = "", pageUrl = "") {
  const image = extractMetaContent(html, "property", "og:image");
  return image ? absoluteUrl(image, pageUrl) : null;
}

function extractArticleText(html = "") {
  const candidates = [
    String(html).match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1],
    String(html).match(
      /<(?:div|section)\b[^>]+class=["'][^"']*(?:article-body|article__body|entry-content|content-body|cuerpo|texto)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i
    )?.[1]
  ].filter(Boolean);

  const selected = candidates.sort((a, b) => b.length - a.length)[0] || html;
  return stripHtmlKeepingLines(selected);
}

function createDate(year, month, day) {
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

function toISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function isAllowedDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const minimum = new Date(today);
  minimum.setDate(minimum.getDate() - MAX_PAST_DAYS);

  const maximum = new Date(today);
  maximum.setDate(maximum.getDate() + MAX_FUTURE_DAYS);

  return date >= minimum && date <= maximum;
}

function extractDateCandidates(text = "") {
  const normalized = normalizeText(text);
  const dates = [];

  for (const match of normalized.matchAll(
    /\b([0-3]?\d)[\/.-]([01]?\d)[\/.-](20\d{2})\b/g
  )) {
    const date = createDate(match[3], match[2], match[1]);
    if (date) dates.push(date);
  }

  for (const match of normalized.matchAll(
    /\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/g
  )) {
    const year = Number(match[3] || new Date().getFullYear());
    const date = createDate(year, MONTHS[match[2]], match[1]);
    if (date) dates.push(date);
  }

  return dates;
}

function extractEventDate(title = "", body = "") {
  /*
    Priorizamos el título porque las fichas de CMM suelen incluir
    la fecha de la retransmisión entre paréntesis.
  */
  const titleDates = extractDateCandidates(title);
  const allowedTitleDate = titleDates.find(isAllowedDate);
  if (allowedTitleDate) return allowedTitleDate;

  const bodyDates = extractDateCandidates(body);
  const allowedBodyDates = bodyDates.filter(isAllowedDate);

  /*
    En una ficha puede aparecer la fecha de publicación además de la emisión.
    Preferimos fechas precedidas por expresiones de programación.
  */
  const normalizedBody = normalizeText(body);

  for (const date of allowedBodyDates) {
    const isoSpanish = `${String(date.getDate()).padStart(2, "0")}/${String(
      date.getMonth() + 1
    ).padStart(2, "0")}/${date.getFullYear()}`;

    const index = normalizedBody.indexOf(isoSpanish);
    if (index >= 0) {
      const context = normalizedBody.slice(Math.max(0, index - 100), index + 100);
      if (
        /directo|retransmision|emitira|television|playtoros|toros desde|novillada|corrida|rejones/.test(
          context
        )
      ) {
        return date;
      }
    }
  }

  return allowedBodyDates[0] || null;
}

function extractTime(title = "", body = "") {
  const combined = normalizeText(`${title}\n${body}`);

  const patterns = [
    /\b(?:a\s+las?|desde\s+las?|a\s+partir\s+de\s+las?|en\s+directo\s+a\s+las?)\s+([01]?\d|2[0-3])[:.h]([0-5]\d)\s*(?:horas?|h)?\b/i,
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:horas?|h)\b/i,
    /\b([01]?\d|2[0-3])h([0-5]\d)\b/i
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) {
      return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
    }
  }

  return null;
}

function inferType(text = "") {
  const value = normalizeText(text);

  if (/concurso\s+de\s+recortadores|recortadores/.test(value)) {
    return "Concurso de recortadores";
  }

  if (/corrida\s+(?:mixta\s+)?de\s+rejones|rejones|rejoneo/.test(value)) {
    return "Rejones";
  }

  if (/novillada\s+sin\s+picadores/.test(value)) {
    return "Novillada sin picadores";
  }

  if (/novillada\s+con\s+picadores/.test(value)) {
    return "Novillada con picadores";
  }

  if (/novillada\s+mixta/.test(value)) {
    return "Novillada mixta";
  }

  if (/novillada/.test(value)) {
    return "Novillada";
  }

  if (/corrida\s+mixta/.test(value)) {
    return "Corrida mixta";
  }

  if (/corrida\s+de\s+toros|corrida/.test(value)) {
    return "Corrida de toros";
  }

  if (/festival/.test(value)) {
    return "Festival taurino";
  }

  if (/becerrada/.test(value)) {
    return "Becerrada";
  }

  return "Festejo taurino";
}

function cleanLocation(value = "") {
  return normalizeWhitespace(value)
    .replace(/\s*\((?:\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2})\)\s*$/i, "")
    .replace(/\s+(?:en\s+directo|directo)$/i, "")
    .replace(/\s*[|–—-]\s*(?:Toros|CMM|CMMPlay).*$/i, "")
    .replace(/^(?:toros|corrida|novillada|rejones)\s+desde\s+/i, "")
    .trim();
}

function extractLocation(title = "", body = "") {
  const candidates = [
    title.match(
      /\bdesde\s+(.+?)(?=\s*\(\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}\)|\s*[|–—-]\s*CMM|$)/i
    )?.[1],
    title.match(
      /\ben\s+(.+?)(?=\s*\(\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}\)|\s*[|–—-]\s*CMM|$)/i
    )?.[1],
    body.match(
      /\bdesde\s+(?:la\s+plaza\s+de\s+toros\s+de\s+)?([^\n.;]+?)(?=\s+(?:a\s+las|con|donde|el\s+\d)|[.;\n]|$)/i
    )?.[1]
  ];

  for (const candidate of candidates) {
    const cleaned = cleanLocation(candidate || "");
    if (
      cleaned.length >= 2 &&
      cleaned.length <= 90 &&
      !/television|playtoros|castilla-la mancha media|cmm/i.test(cleaned)
    ) {
      return cleaned;
    }
  }

  return "";
}

function cleanBreeding(value = "") {
  const cleaned = normalizeWhitespace(value)
    .replace(/^(?:la\s+)?ganader[ií]a\s+(?:de\s+)?/i, "")
    .replace(/\s+(?:para|que|con)\s+.+$/i, "")
    .replace(/\s+y\s+sobreros.*$/i, "")
    .trim();

  if (
    !cleaned ||
    cleaned.length > 100 ||
    /(?:directo|televisi[oó]n|programaci[oó]n|comentarios?|responder|me gusta)/i.test(
      cleaned
    )
  ) {
    return "";
  }

  return cleaned;
}

function extractBreeding(body = "") {
  const patterns = [
    /\b(?:toros|novillos|reses)\s+de\s+(?:la\s+ganader[ií]a\s+de\s+)?([^\n.;:]+?)(?=\s+(?:para|que|con|serán|seran)|[.;:\n]|$)/i,
    /\bganader[ií]a\s*[:\-]?\s*(?:de\s+)?([^\n.;:]+?)(?=\s+(?:para|que|con)|[.;:\n]|$)/i,
    /\bante\s+(?:toros|novillos|reses)\s+de\s+([^\n.;:]+?)(?=[.;:\n]|$)/i
  ];

  for (const pattern of patterns) {
    const value = cleanBreeding(body.match(pattern)?.[1] || "");
    if (value) return value;
  }

  return "";
}

function splitNames(value = "") {
  return value
    .replace(
      /\s+(?:ante|con|frente\s+a)\s+(?:toros|novillos|reses).*$/i,
      ""
    )
    .split(/\s*,\s*|\s+ y \s+/i)
    .map(name =>
      normalizeWhitespace(
        name
          .replace(
            /^(?:los\s+)?(?:diestros|matadores|toreros|novilleros|rejoneadores)\s*[:\-]?\s*/i,
            ""
          )
          .replace(/\s+\((?:[A-ZÁÉÍÓÚÑ][^)]+)\)\s*$/i, "")
      )
    )
    .filter(name => {
      if (name.length < 3 || name.length > 65) return false;
      if (
        /ganader[ií]a|toros?|novillos?|directo|televisi[oó]n|plaza|cmm|playtoros|hora/i.test(
          name
        )
      ) {
        return false;
      }
      return true;
    });
}

function extractParticipants(body = "") {
  const participants = [];

  const patterns = [
    /\bcartel\s+(?:formado|compuesto|integrado)\s+por\s+([^\n.;:]+)/gi,
    /\b(?:actuarán|actuaran|torearán|torearan|participarán|participaran|se\s+medirán|se\s+mediran)\s+([^\n.;:]+)/gi,
    /\b(?:matadores|diestros|toreros|novilleros|rejoneadores)\s*[:\-]\s*([^\n.;]+)/gi
  ];

  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      participants.push(...splitNames(match[1]));
    }
  }

  /*
    Las fichas de vídeo de CMM a veces colocan una etiqueta en una línea
    y después un nombre por línea.
  */
  const lines = body
    .split("\n")
    .map(normalizeWhitespace)
    .filter(Boolean);

  for (let index = 0; index < lines.length; index++) {
    if (
      /^(?:matadores|diestros|toreros|novilleros|rejoneadores)\s*:?\s*$/i.test(
        lines[index]
      )
    ) {
      for (let offset = 1; offset <= 8; offset++) {
        const line = lines[index + offset];
        if (!line) break;
        if (
          /^(?:ganader[ií]a|toros?|novillos?|duraci[oó]n|fecha|hora|cmm)/i.test(
            line
          )
        ) {
          break;
        }
        participants.push(...splitNames(line));
      }
    }
  }

  return unique(participants).slice(0, 8);
}

function confirmsTaurineBroadcast(title = "", body = "", url = "") {
  const value = normalizeText(`${title}\n${body}\n${url}`);

  const taurine =
    /\btoros?\b|\bcorrida\b|\bnovillada\b|\brejones\b|\brejoneo\b|\bfestival\s+taurino\b|\bbecerrada\b/.test(
      value
    );

  const cmmContext =
    /\/(?:tv|play)\/toros\//.test(url) ||
    /\bcmm\b|\bcastilla la mancha media\b|\bplaytoros\b/.test(value);

  /*
    En /play/toros las fichas ya son emisiones oficiales.
    No exigimos que el texto contenga literalmente "en directo",
    porque algunas fichas publican el vídeo con el mismo título del directo.
  */
  return taurine && cmmContext;
}

function createId(event) {
  const slug = normalizeText(
    `${event.date}-${event.location}-${event.type}`
  )
    .replace(/[^a-z0-9ñ]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `cmm-${slug || Date.now()}`;
}

function detailPageToEvent({ html, url }) {
  const canonicalUrl = extractCanonicalUrl(html, url);
  const title = extractTitle(html);
  const description = extractDescription(html);
  const articleText = extractArticleText(html);
  const body = normalizeWhitespace(`${description}\n${articleText}`);

  if (!confirmsTaurineBroadcast(title, body, canonicalUrl)) {
    return null;
  }

  const date = extractEventDate(title, body);

  if (!date || !isAllowedDate(date)) {
    return null;
  }

  const combined = `${title}\n${body}`;

  const event = {
    id: null,
    source: "CMM",
    date: toISODate(date),
    time: extractTime(title, body),
    channel: "CMM",
    location: extractLocation(title, body),
    type: inferType(combined),
    contentType: "festejo",
    breeding: extractBreeding(body),
    participants: extractParticipants(body),
    name: title,
    title,
    image: extractImage(html, canonicalUrl),
    eventUrl: canonicalUrl,
    sourceUrl: canonicalUrl
  };

  if (!event.location) {
    return null;
  }

  event.id = createId(event);
  return event;
}

function eventScore(event) {
  let score = 0;
  if (event.time) score += 2;
  if (event.location) score += 3;
  if (event.type && event.type !== "Festejo taurino") score += 1;
  if (event.breeding) score += 2;
  score += Math.min(event.participants.length, 3);
  if (event.image) score += 1;
  return score;
}

function sameEvent(first, second) {
  if (first.date !== second.date) return false;

  const firstLocation = normalizeText(first.location)
    .replace(/\b(?:albacete|toledo|guadalajara|ciudad real|cuenca)\b/g, "")
    .trim();

  const secondLocation = normalizeText(second.location)
    .replace(/\b(?:albacete|toledo|guadalajara|ciudad real|cuenca)\b/g, "")
    .trim();

  return (
    firstLocation === secondLocation ||
    firstLocation.includes(secondLocation) ||
    secondLocation.includes(firstLocation)
  );
}

function mergeEvents(events = []) {
  const merged = [];

  for (const event of events.sort((a, b) => eventScore(b) - eventScore(a))) {
    const existing = merged.find(candidate => sameEvent(candidate, event));

    if (!existing) {
      merged.push({ ...event });
      continue;
    }

    existing.time ||= event.time;
    existing.location ||= event.location;
    existing.breeding ||= event.breeding;
    existing.image ||= event.image;
    existing.eventUrl ||= event.eventUrl;
    existing.sourceUrl ||= event.sourceUrl;

    if (event.participants.length > existing.participants.length) {
      existing.participants = event.participants;
    }

    if (
      existing.type === "Festejo taurino" &&
      event.type !== "Festejo taurino"
    ) {
      existing.type = event.type;
    }

    if (eventScore(event) > eventScore(existing)) {
      existing.name = event.name || existing.name;
      existing.title = event.title || existing.title;
    }
  }

  return merged.sort((a, b) => {
    const dateComparison = a.date.localeCompare(b.date);
    if (dateComparison !== 0) return dateComparison;

    return String(a.time || "99:99").localeCompare(
      String(b.time || "99:99")
    );
  });
}

async function discoverDetailUrls() {
  const urls = [];
  const errors = [];

  for (const startUrl of START_URLS) {
    try {
      const { html, finalUrl } = await fetchPage(startUrl);
      urls.push(...extractLinks(html, finalUrl));
    } catch (error) {
      /*
        Algunas páginas de paginación pueden no existir.
        Eso no invalida las páginas principales.
      */
      errors.push({
        phase: "discover",
        url: startUrl,
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
  console.log("AlberoTV — CMM");
  console.log("Leyendo directamente las páginas oficiales de Toros de CMM...");

  const discovery = await discoverDetailUrls();
  const events = [];
  const errors = [...discovery.errors];

  console.log(
    `${discovery.urls.length} fichas taurinas oficiales encontradas`
  );

  for (let index = 0; index < discovery.urls.length; index++) {
    const url = discovery.urls[index];

    try {
      const { html, finalUrl } = await fetchPage(url);
      const event = detailPageToEvent({
        html,
        url: finalUrl
      });

      if (event) events.push(event);
    } catch (error) {
      errors.push({
        phase: "detail",
        url,
        error: error.message
      });
    }

    if ((index + 1) % 20 === 0) {
      console.log(
        `Procesadas ${index + 1}/${discovery.urls.length} fichas`
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const finalEvents = mergeEvents(events);

  const output = {
    source: "CMM",
    updatedAt: new Date().toISOString(),
    eventCount: finalEvents.length,
    checkedPages: discovery.urls.length,
    discoveryPages: START_URLS.length,
    errorCount: errors.length,
    events: finalEvents,
    errors: errors.slice(0, 20)
  };

  await fs.mkdir(path.dirname(OUTPUT_FILE), {
    recursive: true
  });

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("");
  console.log(`CMM: ${finalEvents.length} eventos encontrados`);
  console.log(`Fichas comprobadas: ${discovery.urls.length}`);
  console.log(`Errores no fatales: ${errors.length}`);
  console.log(`Salida: ${OUTPUT_FILE}`);

  if (!finalEvents.length) {
    console.warn(
      "Aviso: no se encontraron emisiones dentro del rango permitido."
    );
  }
}

main().catch(error => {
  console.error("");
  console.error("Error actualizando CMM:");
  console.error(error);
  process.exit(1);
});
