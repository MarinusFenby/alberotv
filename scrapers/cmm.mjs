import fs from "node:fs/promises";
import path from "node:path";

const SOURCE = "CMM";
const GUIDE_URL = "https://www.cmmedia.es/play/programacion/tv";
const TOROS_URL = "https://www.cmmedia.es/play/tv/toros";
const OUTPUT = path.resolve("data/cmm.json");

const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)";

function normalizeSpace(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value = "") {
  const entities = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
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
    Ntilde: "Ñ"
  };

  return String(value)
    .replace(/&#(\d+);/g, (_, number) =>
      String.fromCodePoint(Number(number))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      String.fromCodePoint(parseInt(number, 16))
    )
    .replace(/&([a-zA-Z]+);/g, (whole, name) =>
      Object.hasOwn(entities, name) ? entities[name] : whole
    );
}

function stripHtml(html = "") {
  return normalizeSpace(
    decodeHtml(
      String(html)
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|article|section|li|h[1-6]|time|a)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function absoluteUrl(value = "", base = GUIDE_URL) {
  try {
    return new URL(decodeHtml(value), base).href;
  } catch {
    return base;
  }
}

function cleanText(value = "") {
  return normalizeSpace(stripHtml(value))
    .replace(/^>\s*/, "")
    .replace(/<[^>]*$/g, "")
    .trim();
}

function dateToIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function monthNumber(name = "") {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  return {
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
  }[normalized] || null;
}

function resolveYear(month, day, reference = new Date()) {
  const years = [
    reference.getUTCFullYear() - 1,
    reference.getUTCFullYear(),
    reference.getUTCFullYear() + 1
  ];

  return years
    .map(year => ({
      year,
      distance: Math.abs(
        new Date(Date.UTC(year, month - 1, day)) - reference
      )
    }))
    .sort((a, b) => a.distance - b.distance)[0].year;
}

function extractGuideDates(html) {
  const dates = [];
  const seen = new Set();

  for (const match of html.matchAll(
    /\bdata-(?:date|day|fecha)\s*=\s*["'](\d{4})-(\d{2})-(\d{2})["']/gi
  )) {
    const iso = dateToIso(+match[1], +match[2], +match[3]);
    if (iso && !seen.has(iso)) {
      seen.add(iso);
      dates.push(iso);
    }
  }

  const text = stripHtml(html);

  for (const match of text.matchAll(
    /\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)?\s*(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/gi
  )) {
    const day = +match[1];
    const month = monthNumber(match[2]);
    const year = match[3]
      ? +match[3]
      : resolveYear(month, day);

    const iso = dateToIso(year, month, day);

    if (iso && !seen.has(iso)) {
      seen.add(iso);
      dates.push(iso);
    }
  }

  return dates.sort();
}

function extractLinks(fragment, base = GUIDE_URL) {
  const links = [];

  for (const match of String(fragment).matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    links.push({
      url: absoluteUrl(match[1], base),
      text: cleanText(match[2])
    });
  }

  return links;
}

function extractTitle(fragment) {
  const heading = fragment.match(
    /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i
  );

  if (heading) {
    const text = cleanText(heading[1]);
    if (text) return text;
  }

  const links = extractLinks(fragment);
  const useful = links.find(link =>
    link.text &&
    !/^(play|ver|directo|más información|información)$/i.test(link.text)
  );

  return useful?.text || "";
}

function extractSourceUrl(fragment) {
  const links = extractLinks(fragment);
  return links.find(link => link.text)?.url || GUIDE_URL;
}

function isTaurineBroadcast(title = "") {
  const normalized = title.toUpperCase();

  /*
   * El scraper CMM se limita a festejos televisados.
   * Los programas taurinos ya se gestionan en programas-taurinos.mjs.
   */
  return (
    normalized === "TOROS" ||
    /\bCORRIDA\b/.test(normalized) ||
    /\bNOVILLADA\b/.test(normalized) ||
    /\bREJONES?\b/.test(normalized) ||
    /\bRECORTES?\b/.test(normalized)
  );
}

function inferType(title = "", description = "") {
  const text = `${title} ${description}`;

  if (/\brejones?\b|\brejoneo\b/i.test(text)) {
    return "Corrida de rejones";
  }

  if (/\bnovillada\b/i.test(text)) {
    return /\bpicadores\b/i.test(text)
      ? "Novillada con picadores"
      : "Novillada";
  }

  if (/\brecortes?\b/i.test(text)) {
    return "Concurso de recortes";
  }

  return "Corrida de toros";
}

function titleFromSlug(url = "") {
  try {
    const pathname = new URL(url).pathname;
    const slug = pathname.split("/").filter(Boolean).pop() || "";

    return slug
      .replace(/\.html$/i, "")
      .replace(/-\d{2}-\d{2}-\d{4}(?:-\d+)?$/i, "")
      .replace(/-/g, " ")
      .replace(/\b\p{L}/gu, letter => letter.toUpperCase())
      .trim();
  } catch {
    return "";
  }
}

function dateFromUrl(url = "") {
  const match = url.match(/-(\d{2})-(\d{2})-(\d{4})(?:-\d+)?\.html(?:$|\?)/i);
  if (!match) return null;

  return dateToIso(+match[3], +match[2], +match[1]);
}

function isUsefulTorosArticle(url = "") {
  return (
    /\/play\/(?:tv\/)?toros\/[^/]+\.html(?:$|\?)/i.test(url) &&
    !/\/tiempo-de-toros\//i.test(url) &&
    !/presentacion|temporada|protagonistas|entrevista|gala|aficionados|premio/i.test(url)
  );
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "es-ES,es;q=0.9"
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  return response.text();
}

async function buildTorosIndex() {
  const byDate = new Map();
  const pages = [TOROS_URL];

  for (let page = 2; page <= 4; page++) {
    pages.push(`${TOROS_URL}/${page}`);
  }

  for (const pageUrl of pages) {
    let html;

    try {
      html = await fetchHtml(pageUrl);
    } catch {
      continue;
    }

    for (const link of extractLinks(html, pageUrl)) {
      if (!isUsefulTorosArticle(link.url)) continue;

      const date = dateFromUrl(link.url);
      if (!date) continue;

      const title =
        cleanText(link.text) ||
        titleFromSlug(link.url);

      if (!title) continue;

      const candidate = {
        date,
        title,
        url: link.url,
        type: inferType(title)
      };

      const existing = byDate.get(date) || [];

      if (!existing.some(item => item.url === candidate.url)) {
        existing.push(candidate);
        byDate.set(date, existing);
      }
    }
  }

  return byDate;
}

function parseAllScheduleBlocks(html, dates) {
  const timeMatches = [
    ...html.matchAll(
      /(?:^|>|\s)([01]?\d|2[0-3]):([0-5]\d)(?=<|\s|$)/g
    )
  ];

  const allBlocks = [];

  for (let index = 0; index < timeMatches.length; index++) {
    const match = timeMatches[index];
    const start = match.index;
    const end =
      index + 1 < timeMatches.length
        ? timeMatches[index + 1].index
        : html.length;

    const fragment = html.slice(start, end);
    const time = `${String(+match[1]).padStart(2, "0")}:${match[2]}`;
    const title = extractTitle(fragment);

    if (!title) continue;

    const plain = cleanText(fragment);
    const description = normalizeSpace(
      plain
        .replace(new RegExp(`^${time.replace(":", "\\:")}\\s*`), "")
        .replace(title, "")
        .replace(/\bPlay\b/gi, "")
        .replace(/<[^>]*$/g, "")
    ).slice(0, 700);

    allBlocks.push({
      time,
      title,
      description,
      sourceUrl: extractSourceUrl(fragment)
    });
  }

  /*
   * Primero asignamos fechas a TODA la parrilla.
   * Después filtramos los espacios taurinos.
   * Este orden evita que las fechas se desplacen.
   */
  let dayIndex = 0;
  let previousMinutes = null;

  for (const block of allBlocks) {
    const [hour, minute] = block.time.split(":").map(Number);
    const currentMinutes = hour * 60 + minute;

    if (
      previousMinutes !== null &&
      currentMinutes < previousMinutes &&
      dayIndex < dates.length - 1
    ) {
      dayIndex++;
    }

    block.date = dates[dayIndex] || dates[0] || null;
    previousMinutes = currentMinutes;
  }

  return allBlocks.filter(
    block => block.date && isTaurineBroadcast(block.title)
  );
}

function chooseArticle(articles = [], usedUrls = new Set()) {
  const unused = articles.find(article => !usedUrls.has(article.url));
  return unused || articles[0] || null;
}

function deduplicate(events) {
  const map = new Map();

  for (const event of events) {
    const key = [
      event.date,
      event.time,
      event.title.toLowerCase()
    ].join("|");

    if (!map.has(key)) map.set(key, event);
  }

  return [...map.values()].sort((a, b) =>
    `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)
  );
}

async function main() {
  const generatedAt = new Date().toISOString();
  const errors = [];
  let guideHtml = "";
  let dates = [];
  let schedule = [];
  let torosIndex = new Map();

  try {
    guideHtml = await fetchHtml(GUIDE_URL);
    dates = extractGuideDates(guideHtml);
    schedule = parseAllScheduleBlocks(guideHtml, dates);
  } catch (error) {
    errors.push({
      url: GUIDE_URL,
      error: error.message
    });
  }

  try {
    torosIndex = await buildTorosIndex();
  } catch (error) {
    errors.push({
      url: TOROS_URL,
      error: error.message
    });
  }

  const usedUrls = new Set();

  const events = deduplicate(
    schedule.map((item, index) => {
      const candidates = torosIndex.get(item.date) || [];
      const article =
        item.title.toUpperCase() === "TOROS"
          ? chooseArticle(candidates, usedUrls)
          : null;

      if (article) usedUrls.add(article.url);

      const title =
        article?.title ||
        (item.title.toUpperCase() === "TOROS"
          ? "Toros en CMM"
          : item.title);

      return {
        id: `cmm-${item.date}-${item.time.replace(":", "")}-${index + 1}`,
        source: SOURCE,
        title,
        type: article?.type || inferType(title, item.description),
        date: item.date,
        time: item.time,
        channel: "CMM",
        location: "",
        breeding: "",
        participants: [],
        description: item.description,
        sourceUrl: article?.url || item.sourceUrl || GUIDE_URL
      };
    })
  );

  const output = {
    source: SOURCE,
    generatedAt,
    sourceUrl: GUIDE_URL,
    status: errors.length ? "partial" : "ok",
    eventCount: events.length,
    checkedPages: guideHtml ? 5 : 0,
    discoveredDates: dates,
    errorCount: errors.length,
    errors,
    events
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(
    OUTPUT,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`CMM: ${events.length} festejos encontrados.`);
  console.log(`Fechas detectadas: ${dates.length}.`);
  console.log(`Archivo guardado en ${OUTPUT}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
