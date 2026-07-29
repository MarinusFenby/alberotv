// scrapers/canal-extremadura.mjs

import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://www.canalextremadura.es";
const GUIDE_PAGES = [
  { route: "/guia/sat/ayer", offset: -1 },
  { route: "/guia/sat", offset: 0 },
  { route: "/guia/sat/mañana", offset: 1 },
  { route: "/guia/sat/pasado", offset: 2 }
];

const OUTPUT_FILE = path.resolve(process.cwd(), "data", "canal-extremadura.json");

const TAURINE_TERMS = [
  "tierra de toros", "corrida", "corridas", "novillada", "novilladas",
  "novillos", "rejones", "rejoneo", "rejoneadores", "festival taurino",
  "festejo taurino", "encierro", "encierros", "recortes", "recortadores",
  "concurso de recortes", "toros"
];

function decodeHtmlEntities(value = "") {
  const named = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
    ndash: "–", mdash: "—", aacute: "á", eacute: "é", iacute: "í",
    oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É",
    Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ"
  };

  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(named, name) ? named[name] : match
    );
}

function cleanText(value = "") {
  return decodeHtmlEntities(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(value = "") {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function isTaurine(title = "") {
  const normalized = normalizeText(title);
  return TAURINE_TERMS.some(term => normalized.includes(normalizeText(term)));
}

function classifyContent(title = "") {
  const normalized = normalizeText(title);

  if (normalized.includes("tierra de toros")) {
    return { type: "Programa taurino", contentType: "programa" };
  }

  if (normalized.includes("rejones") || normalized.includes("rejoneo") || normalized.includes("rejoneadores")) {
    return { type: "Corrida de rejones", contentType: "festejo" };
  }

  if (normalized.includes("novillada") || normalized.includes("novillos")) {
    return {
      type: normalized.includes("sin picadores")
        ? "Novillada sin picadores"
        : normalized.includes("con picadores")
          ? "Novillada con picadores"
          : "Novillada",
      contentType: "festejo"
    };
  }

  if (normalized.includes("recortes") || normalized.includes("recortadores")) {
    return { type: "Concurso de recortes", contentType: "festejo" };
  }

  if (normalized.includes("encierro") || normalized.includes("encierros")) {
    return { type: "Encierro", contentType: "festejo" };
  }

  if (normalized.includes("festival")) {
    return { type: "Festival taurino", contentType: "festejo" };
  }

  return { type: "Corrida de toros", contentType: "festejo" };
}

function madridDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function addDaysInMadrid(offset = 0) {
  const { year, month, day } = madridDateParts();
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + offset);

  return [
    base.getUTCFullYear(),
    String(base.getUTCMonth() + 1).padStart(2, "0"),
    String(base.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function extractRows(html = "") {
  const rows = [];
  const wrapperPattern =
    /<div\b[^>]*class=["'][^"']*\bviews-row-wrapper\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bviews-row-wrapper\b|$)/gi;

  let wrapperMatch;

  while ((wrapperMatch = wrapperPattern.exec(html)) !== null) {
    const block = wrapperMatch[1];

    const hourMatch = block.match(
      /<div\b[^>]*class=["'][^"']*\bbroadcast-hour\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    );

    const titleMatch = block.match(
      /<div\b[^>]*class=["'][^"']*\bbroadcast-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    );

    const time = cleanText(hourMatch?.[1] || "");
    const title = cleanText(titleMatch?.[1] || "");

    if (/^\d{1,2}:\d{2}$/.test(time) && title) {
      rows.push({ time: time.padStart(5, "0"), title });
    }
  }

  if (rows.length === 0) {
    const fallbackPattern =
      /class=["'][^"']*\bbroadcast-hour\b[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]{0,1500}?class=["'][^"']*\bbroadcast-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;

    let fallbackMatch;

    while ((fallbackMatch = fallbackPattern.exec(html)) !== null) {
      const time = cleanText(fallbackMatch[1]);
      const title = cleanText(fallbackMatch[2]);

      if (/^\d{1,2}:\d{2}$/.test(time) && title) {
        rows.push({ time: time.padStart(5, "0"), title });
      }
    }
  }

  return rows;
}

function cleanBroadcastTitle(title = "") {
  return cleanText(title)
    .replace(/\s+Temp:\s*\d+\.?/gi, "")
    .replace(/\s*\[\d+\]\s*$/g, "")
    .trim();
}

function createEvent({ date, time, title, sourceUrl }) {
  const cleanedTitle = cleanBroadcastTitle(title);
  const { type, contentType } = classifyContent(cleanedTitle);
  const fetchedAt = new Date().toISOString();

  return {
    id: `canal-extremadura-${date}-${time}-${slugify(cleanedTitle)}`,
    date,
    time,
    channel: "Canal Extremadura",
    location: contentType === "programa" ? "Televisión" : "",
    type,
    contentType,
    breeding: "",
    participants: [],
    name: contentType === "programa" ? cleanedTitle : "",
    title: cleanedTitle,
    image: null,
    eventUrl: sourceUrl,
    sourceUrl,
    sources: ["Canal Extremadura"],
    sourceDetails: [
      {
        name: "Canal Extremadura",
        confidence: 100,
        sourceUrl,
        fetchedAt
      }
    ],
    confidence: 100,
    status: "confirmed"
  };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-ES,es;q=0.9"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Canal Extremadura respondió ${response.status} en ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function deduplicate(events = []) {
  const map = new Map();

  for (const event of events) {
    const key = [event.date, event.time, normalizeText(event.title)].join("|");
    if (!map.has(key)) map.set(key, event);
  }

  return [...map.values()].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
  );
}

async function scrapeGuidePage(page) {
  const sourceUrl = new URL(page.route, BASE_URL).href;

  console.log(`Leyendo ${sourceUrl}`);

  const html = await fetchHtml(sourceUrl);
  const date = addDaysInMadrid(page.offset);
  const rows = extractRows(html);

  console.log(`  ${rows.length} emisiones encontradas`);

  const taurineRows = rows.filter(row => isTaurine(row.title));

  console.log(`  ${taurineRows.length} emisiones taurinas`);

  return taurineRows.map(row =>
    createEvent({
      date,
      time: row.time,
      title: row.title,
      sourceUrl
    })
  );
}

async function main() {
  console.log("AlberoTV — Canal Extremadura");

  const results = await Promise.allSettled(GUIDE_PAGES.map(scrapeGuidePage));
  const events = [];
  const errors = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      events.push(...result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  if (errors.length === GUIDE_PAGES.length) {
    throw new Error(`No se pudo leer ninguna parrilla:\n${errors.join("\n")}`);
  }

  for (const error of errors) {
    console.warn(`Aviso: ${error}`);
  }

  const finalEvents = deduplicate(events);

  const output = {
    source: "Canal Extremadura",
    updatedAt: new Date().toISOString(),
    events: finalEvents
  };

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`Finalizado: ${finalEvents.length} emisiones taurinas guardadas`);
  console.log(`Archivo: ${OUTPUT_FILE}`);
}

main().catch(error => {
  console.error("");
  console.error("Error fatal en el scraper de Canal Extremadura:");
  console.error(error);
  process.exitCode = 1;
});
