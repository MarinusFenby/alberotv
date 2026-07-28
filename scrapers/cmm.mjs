import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_FILE = path.resolve(process.cwd(), "data", "cmm.json");

const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)";

const SEARCH_URL =
  "https://news.google.com/rss/search?" +
  new URLSearchParams({
    q:
      'site:cmmedia.es ' +
      '(toros OR corrida OR novillada OR rejones OR festejo taurino) ' +
      '(emitirá OR directo OR retransmisión OR retransmitirá OR PlayToros OR CMM)',
    hl: "es",
    gl: "ES",
    ceid: "ES:es"
  }).toString();

const MAX_ARTICLES = 50;
const MAX_PAST_DAYS = 7;
const MAX_FUTURE_DAYS = 180;

function normalizeWhitespace(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
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

function stripHtml(html = "") {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n")
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

function toISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
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

function isAllowedDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const minimum = new Date(today);
  minimum.setDate(minimum.getDate() - MAX_PAST_DAYS);

  const maximum = new Date(today);
  maximum.setDate(maximum.getDate() + MAX_FUTURE_DAYS);

  return date >= minimum && date <= maximum;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "es-ES,es;q=0.9"
    },
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  return response.text();
}

function extractRssItems(xml = "") {
  const items = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];

    const title =
      item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
      item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
      "";

    const link =
      item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ||
      "";

    const publishedAt =
      item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ||
      "";

    items.push({
      title: normalizeWhitespace(decodeHtmlEntities(title)),
      link: normalizeWhitespace(decodeHtmlEntities(link)),
      publishedAt
    });
  }

  return items;
}

function extractCanonicalUrl(html = "", fallbackUrl = "") {
  const canonical =
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    )?.[1] ||
    html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
    )?.[1];

  return canonical || fallbackUrl;
}

function extractTitle(html = "") {
  const openGraph =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    )?.[1];

  const heading =
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];

  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  return stripHtml(openGraph || heading || title || "");
}

function extractImage(html = "") {
  return (
    html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    )?.[1] ||
    null
  );
}

function inferYear(text, referenceDate = new Date()) {
  const explicitYear = text.match(/\b(20\d{2})\b/)?.[1];
  return explicitYear ? Number(explicitYear) : referenceDate.getFullYear();
}

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

function extractDate(text = "", referenceDate = new Date()) {
  const normalized = normalizeText(text);

  const numeric = normalized.match(
    /\b([0-3]?\d)[\/.-]([01]?\d)[\/.-](20\d{2})\b/
  );

  if (numeric) {
    return createDate(numeric[3], numeric[2], numeric[1]);
  }

  const written = normalized.match(
    /\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/
  );

  if (written) {
    const year = written[3]
      ? Number(written[3])
      : inferYear(normalized, referenceDate);

    return createDate(year, MONTHS[written[2]], written[1]);
  }

  return null;
}

function extractTime(text = "") {
  const normalized = normalizeText(text);

  const matches = [
    ...normalized.matchAll(
      /\b(?:a\s+las?|desde\s+las?|a\s+partir\s+de\s+las?)\s+([01]?\d|2[0-3])[:.h]([0-5]\d)\s*(?:horas?|h)?\b/g
    ),
    ...normalized.matchAll(
      /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:horas?|h)\b/g
    )
  ];

  if (!matches.length) {
    return null;
  }

  const [hour, minute] = matches[0].slice(1, 3);

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function inferType(text = "") {
  const value = normalizeText(text);

  if (/corrida\s+de\s+rejones|rejones/.test(value)) {
    return "Corrida de rejones";
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

function extractLocation(title = "", text = "") {
  const candidates = [
    title.match(/\bdesde\s+([^|,.;:()]+(?:\s+\([^)]*\))?)/i)?.[1],
    text.match(/\bdesde\s+(?:la\s+plaza\s+de\s+toros\s+de\s+)?([^,.;:\n]+?)(?=\s+(?:con|a\s+las|el\s+\d|este\s+|donde\s+)|[,.;:\n])/i)?.[1],
    title.match(/\ben\s+([^|,.;:()]+(?:\s+\([^)]*\))?)/i)?.[1]
  ];

  for (const candidate of candidates) {
    const cleaned = normalizeWhitespace(candidate || "")
      .replace(/\s+(?:en\s+directo|directo)$/i, "")
      .replace(/\s+por\s+CMM.*$/i, "")
      .trim();

    if (cleaned && cleaned.length >= 3 && cleaned.length <= 80) {
      return cleaned;
    }
  }

  return "";
}

function extractBreeding(text = "") {
  const patterns = [
    /\b(?:toros|novillos|reses)\s+de\s+(?:la\s+ganader[ií]a\s+de\s+)?([^.;:\n]+?)(?=\s+(?:para|que|con|y\s+los)|[.;:\n])/i,
    /\bganader[ií]a\s+(?:de\s+)?([^.;:\n]+?)(?=\s+(?:para|que|con)|[.;:\n])/i,
    /\bante\s+(?:toros|novillos|reses)\s+de\s+([^.;:\n]+?)(?=[.;:\n]|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1];

    if (match) {
      return normalizeWhitespace(match)
        .replace(/^la\s+/i, "")
        .replace(/\s+y\s+sobreros.*$/i, "")
        .trim();
    }
  }

  return "";
}

function extractParticipants(text = "") {
  const participants = [];

  const introductions = [
    /\bcartel\s+(?:formado|compuesto|integrado)\s+por\s+([^.;:\n]+)/gi,
    /\b(?:actuarán|torearán|participarán|se\s+medirán)\s+([^.;:\n]+)/gi,
    /\bcon\s+un\s+cartel\s+formado\s+por\s+([^.;:\n]+)/gi
  ];

  for (const pattern of introductions) {
    for (const match of text.matchAll(pattern)) {
      const names = match[1]
        .replace(/\s+(?:ante|con)\s+(?:toros|novillos|reses).*$/i, "")
        .split(/\s*,\s*|\s+y\s+/i)
        .map(name =>
          normalizeWhitespace(
            name
              .replace(/^(?:los\s+)?(?:diestros|toreros|novilleros|rejoneadores)\s+/i, "")
              .replace(/\s+(?:ante|frente)\s+.*$/i, "")
          )
        )
        .filter(name => name.length >= 3 && name.length <= 60);

      participants.push(...names);
    }
  }

  return unique(participants).slice(0, 8);
}

function confirmsBroadcast(text = "") {
  const value = normalizeText(text);

  const taurine =
    /\btoros?\b|\bcorrida\b|\bnovillada\b|\brejones\b|\bfestejo\s+taurino\b/.test(
      value
    );

  const broadcast =
    /\ben\s+directo\b|\bretransmitira\b|\bretransmision\b|\bemitira\b|\bpodra\s+verse\b|\bplaytoros\b|\bcmmplay\b/.test(
      value
    );

  return taurine && broadcast;
}

function createId(event) {
  const slug = normalizeText(
    `${event.date}-${event.location}-${event.type}`
  )
    .replace(/[^a-z0-9ñ]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `cmm-${slug || Date.now()}`;
}

function articleToEvent({ html, url, publishedAt }) {
  const title = extractTitle(html);
  const body = stripHtml(html);
  const combined = `${title}\n${body}`;

  if (!confirmsBroadcast(combined)) {
    return null;
  }

  const referenceDate = publishedAt
    ? new Date(publishedAt)
    : new Date();

  const date = extractDate(combined, referenceDate);

  if (!date || !isAllowedDate(date)) {
    return null;
  }

  const event = {
    id: null,
    source: "CMM",
    date: toISODate(date),
    time: extractTime(combined),
    channel: "CMM",
    location: extractLocation(title, body),
    type: inferType(combined),
    contentType: "festejo",
    breeding: extractBreeding(body),
    participants: extractParticipants(body),
    name: title,
    title,
    image: extractImage(html),
    eventUrl: extractCanonicalUrl(html, url),
    sourceUrl: extractCanonicalUrl(html, url)
  };

  event.id = createId(event);

  return event;
}

function isSameEvent(first, second) {
  return (
    first.date === second.date &&
    normalizeText(first.location) === normalizeText(second.location) &&
    normalizeText(first.type) === normalizeText(second.type)
  );
}

async function resolveGoogleNewsUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT
      },
      signal: AbortSignal.timeout(15000)
    });

    return response.url || url;
  } catch {
    return url;
  }
}

async function main() {
  const rss = await fetchText(SEARCH_URL);
  const items = extractRssItems(rss).slice(0, MAX_ARTICLES);

  const events = [];
  const errors = [];

  for (const item of items) {
    try {
      const resolvedUrl = await resolveGoogleNewsUrl(item.link);

      if (!/https?:\/\/(?:www\.)?cmmedia\.es\//i.test(resolvedUrl)) {
        continue;
      }

      const html = await fetchText(resolvedUrl);
      const event = articleToEvent({
        html,
        url: resolvedUrl,
        publishedAt: item.publishedAt
      });

      if (!event) {
        continue;
      }

      const existing = events.find(candidate =>
        isSameEvent(candidate, event)
      );

      if (!existing) {
        events.push(event);
      } else {
        existing.time ||= event.time;
        existing.location ||= event.location;
        existing.breeding ||= event.breeding;

        if (event.participants.length > existing.participants.length) {
          existing.participants = event.participants;
        }

        existing.image ||= event.image;
        existing.eventUrl ||= event.eventUrl;
        existing.sourceUrl ||= event.sourceUrl;
      }
    } catch (error) {
      errors.push({
        title: item.title,
        url: item.link,
        error: error.message
      });
    }
  }

  events.sort((a, b) => {
    const dateComparison = a.date.localeCompare(b.date);
    if (dateComparison !== 0) return dateComparison;

    return String(a.time || "99:99").localeCompare(
      String(b.time || "99:99")
    );
  });

  const output = {
    source: "CMM",
    updatedAt: new Date().toISOString(),
    eventCount: events.length,
    checkedArticles: items.length,
    errorCount: errors.length,
    events,
    errors: errors.slice(0, 10)
  };

  await fs.mkdir(path.dirname(OUTPUT_FILE), {
    recursive: true
  });

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`CMM: ${events.length} eventos encontrados`);
  console.log(`Artículos comprobados: ${items.length}`);
  console.log(`Errores: ${errors.length}`);
  console.log(`Salida: ${OUTPUT_FILE}`);
}

main().catch(error => {
  console.error("Error actualizando CMM:");
  console.error(error);
  process.exit(1);
});
