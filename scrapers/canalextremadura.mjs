// scrapers/canalextremadura.mjs
// Extrae la programación taurina de la parrilla semanal oficial de Canal Extremadura.
// Requiere: npm install playwright pdfjs-dist
// Genera: data/canalextremadura.json

import { chromium } from "playwright";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const GUIDE_URL = "https://www.canalextremadura.es/guia/television";
const OUTPUT_FILE = "data/canalextremadura.json";
const TIME_ZONE = "Europe/Madrid";

const TAURINE_TERMS = [
  "TOROS",
  "TIERRA DE TOROS",
  "CORRIDA",
  "NOVILLADA",
  "REJONES",
  "ENCIERRO",
  "FESTEJO TAURINO",
  "CERTAMEN TAURINO",
  "TROFEO DIPUTACION"
];

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

function clean(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalized(value = "") {
  return clean(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

function isTaurine(value = "") {
  const text = normalized(value);
  return TAURINE_TERMS.some((term) => text.includes(normalized(term)));
}

function cleanTaurineTitle(rawTitle = "") {
  let title = clean(rawTitle)
    .replace(/\bEXN2\b/gi, "")
    .replace(/\bEXN\b/gi, "")
    .replace(/\bCEX\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const search = normalized(title);

  // Canonicalizar únicamente el texto ya aislado dentro del mismo bloque.
  if (search.includes("TIERRA DE TOROS")) {
    return "Extremadura Tierra de Toros";
  }

  // Para festejos en directo conservamos desde la palabra TOROS.
  const torosIndex = search.indexOf("TOROS");
  if (torosIndex >= 0) {
    const originalUpper = title.toUpperCase();
    const originalIndex = originalUpper.indexOf("TOROS");
    if (originalIndex >= 0) {
      title = title.slice(originalIndex);
    }
  }

  title = title
    .replace(/\bDIP\.\s*BADAJOZ\b/gi, "Diputación de Badajoz")
    .replace(/\bDIPUTACION\b/gi, "Diputación")
    .replace(/\s*-\s*/g, " – ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^TOROS\b/i.test(title)) {
    title = title
      .replace(/^TOROS\s*/i, "TOROS – ")
      .replace(/^TOROS\s*–\s*/i, "TOROS – ");
  }

  return title;
}

function makeId(date, time, title) {
  return `canal-extremadura-${crypto
    .createHash("sha1")
    .update(`${date}|${time}|${title}`)
    .digest("hex")
    .slice(0, 14)}`;
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function toISODate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function inferType(title) {
  const text = normalized(title);

  if (text.includes("NOVILLADA CON PICADORES")) return "Novillada con picadores";
  if (text.includes("NOVILLADA")) return "Novillada";
  if (text.includes("REJONES")) return "Corrida de rejones";
  if (text.includes("CORRIDA DE TOROS")) return "Corrida de toros";
  if (text.includes("ENCIERRO")) return "Encierro";
  if (text.includes("TIERRA DE TOROS")) return "Programa taurino";
  if (text.includes("TOROS")) return "Festejo taurino";

  return "Programa taurino";
}

function parseWeekDates(pdfUrl, pageText) {
  const decoded = decodeURIComponent(pdfUrl).replace(/\+/g, " ");
  const source = `${decoded} ${pageText}`;

  const range = source.match(
    /(?:del?\s*)?(\d{1,2})\s*(?:de\s*)?([a-záéíóúñ]+)?\s*(?:al|a)\s*(\d{1,2})\s*de\s*([a-záéíóúñ]+)\s*de\s*(20\d{2})/i
  );

  if (!range) {
    throw new Error(`No se pudo deducir la semana desde el PDF: ${pdfUrl}`);
  }

  const startDay = Number(range[1]);
  const startMonthName = normalized(range[2] || range[4]).toLowerCase();
  const endDay = Number(range[3]);
  const endMonthName = normalized(range[4]).toLowerCase();
  const year = Number(range[5]);

  const startMonth = MONTHS[startMonthName];
  const endMonth = MONTHS[endMonthName];

  if (!startMonth || !endMonth) {
    throw new Error("No se pudo interpretar el mes de la parrilla.");
  }

  const start = new Date(Date.UTC(year, startMonth - 1, startDay));
  const end = new Date(Date.UTC(year, endMonth - 1, endDay));

  if (end < start) end.setUTCFullYear(year + 1);

  const dates = [];
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(
      toISODate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    );
  }

  if (dates.length !== 7) {
    throw new Error(`La parrilla no contiene siete días: ${dates.join(", ")}`);
  }

  return dates;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function nearestIndex(values, value) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  values.forEach((candidate, index) => {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function parseTime(value) {
  const match = clean(value).match(/^([0-2]?\d):([0-5]\d)$/);
  if (!match || Number(match[1]) > 23) return null;
  return `${pad(Number(match[1]))}:${match[2]}`;
}

function decodeHtmlEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function findWeeklyPdf(page) {
  // Primer intento: leer directamente el HTML. Evita que GitHub Actions
  // se quede esperando a que terminen analíticas, anuncios u otras conexiones.
  try {
    const response = await fetch(GUIDE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
      },
      signal: AbortSignal.timeout(30000)
    });

    if (response.ok) {
      const html = await response.text();

      const matches = [
        ...html.matchAll(
          /href=["']([^"']*(?:PARRILLA|parrilla)[^"']*\.pdf(?:\?[^"']*)?)["']/gi
        )
      ];

      if (matches.length > 0) {
        const href = decodeHtmlEntities(matches[0][1]);
        return new URL(href, GUIDE_URL).href;
      }
    }
  } catch (error) {
    console.warn(
      `[Canal Extremadura] No se pudo localizar el PDF mediante fetch: ${error.message}`
    );
  }

  // Segundo intento: navegador, pero sin esperar a "networkidle".
  // Esa condición puede no llegar nunca en páginas con conexiones permanentes.
  await page.goto(GUIDE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  const link = page
    .locator(
      'a:has-text("Descargar parrilla"), a[href*="PARRILLA"][href$=".pdf"], a[href*="parrilla"][href*=".pdf"]'
    )
    .first();

  await link.waitFor({
    state: "attached",
    timeout: 20000
  });

  const href = await link.getAttribute("href");

  if (!href) {
    throw new Error("No se encontró el enlace «Descargar parrilla».");
  }

  return new URL(decodeHtmlEntities(href), GUIDE_URL).href;
}

export async function readPdf(pdfUrl, localBytes) {
  let bytes = localBytes;
  if (!bytes) {
  const response = await fetch(pdfUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar el PDF (${response.status}).`);
  }

  bytes = new Uint8Array(await response.arrayBuffer());
  }
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();

  const items = content.items
    .map((item) => ({
      text: clean(item.str),
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
      height: Math.abs(item.height || item.transform[3] || 0)
    }))
    .filter((item) => item.text);

  return {
    items,
    edges: horizontalEdges(await page.getOperatorList()),
    pageText: items.map((item) => item.text).join(" ")
  };
}

// PDF paths and text use different coordinate systems. Respect the drawing
// transform stack before comparing a cell border with a text baseline.
export function horizontalEdges(ops) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [], edges = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i], args = ops.argsArray[i];
    if (op === pdfjsLib.OPS.save) stack.push([...matrix]);
    else if (op === pdfjsLib.OPS.restore) matrix = stack.pop();
    else if (op === pdfjsLib.OPS.transform) matrix = pdfjsLib.Util.transform(matrix, args);
    else if (op === pdfjsLib.OPS.constructPath && args[2]?.length === 4) {
      const b = args[2];
      const point = (x, y) => [matrix[0]*x + matrix[2]*y + matrix[4], matrix[1]*x + matrix[3]*y + matrix[5]];
      const a = point(b[0], b[1]), z = point(b[2], b[3]);
      if (Math.abs(z[1]-a[1]) < 1 && Math.abs(z[0]-a[0]) > 20)
        edges.push({left: Math.min(a[0],z[0]), right: Math.max(a[0],z[0]), y: (a[1]+z[1])/2});
    }
  }
  return edges;
}

function detectDayColumns(items) {
  const dayWords = [
    "lunes",
    "martes",
    "miercoles",
    "jueves",
    "viernes",
    "sabado",
    "domingo"
  ];

  const headers = items
    .filter((item) =>
      dayWords.some((day) => normalized(item.text).startsWith(day.toUpperCase()))
    )
    .sort((a, b) => a.x - b.x);

  if (headers.length >= 7) {
    return headers.slice(0, 7).map((item) => item.x + item.width / 2);
  }

  throw new Error("No se identifican las siete columnas de la parrilla; no se adivinan fechas.");
}

function detectTimeRows(items, columnCenters) {
  const minDayX = Math.min(...columnCenters);
  const maxDayX = Math.max(...columnCenters);

  const candidates = items
    .map((item) => ({ ...item, time: parseTime(item.text) }))
    .filter(
      (item) =>
        item.time &&
        (item.x < minDayX - 15 || item.x > maxDayX + 15)
    );

  const grouped = new Map();

  for (const item of candidates) {
    const key = Math.round(item.y);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  return [...grouped.values()]
    .map((group) => ({
      y: median(group.map((item) => item.y)),
      time: group[0].time
    }))
    .sort((a, b) => b.y - a.y);
}

export function extractEvents(items, dates, pdfUrl, edges = []) {
  const columnCenters = detectDayColumns(items);
  const timeRows = detectTimeRows(items, columnCenters);
  const events = [];
  const seen = new Set();

  for (const item of items) {
    if (!isTaurine(item.text)) continue;

    const itemCenter = item.x + item.width / 2;
    const dayIndex = nearestIndex(columnCenters, itemCenter);

    if (dayIndex < 0 || dayIndex > 6) continue;

    const borders = edges.filter(e => e.left < columnCenters[dayIndex] && e.right > columnCenters[dayIndex]);
    const top = borders.filter(e => e.y > item.y + item.height / 2).sort((a,b) => a.y-b.y)[0];
    const bottom = borders.filter(e => e.y < item.y).sort((a,b) => b.y-a.y)[0];
    if (!top || !bottom) throw new Error(`No se puede aislar el bloque: ${item.text}`);
    const rowIndex = timeRows.findIndex(r => r.y < top.y);
    if (rowIndex < 0 || timeRows[rowIndex].y <= bottom.y)
      throw new Error(`No se puede confirmar la hora del bloque: ${item.text}`);
    const time = timeRows[rowIndex].time;
    let dayOffset = 0;
    for (let i = 1; i <= rowIndex; i++) if (timeRows[i].time < timeRows[i-1].time) dayOffset++;
    const calendarDate = new Date(`${dates[dayIndex]}T00:00:00Z`);
    calendarDate.setUTCDate(calendarDate.getUTCDate() + dayOffset);
    const date = calendarDate.toISOString().slice(0,10);
    const title = cleanTaurineTitle(items.filter(part =>
      nearestIndex(columnCenters, part.x + part.width/2) === dayIndex &&
      part.y > bottom.y && part.y < top.y && !parseTime(part.text)
    ).sort((a,b) => Math.abs(a.y-b.y)>2 ? b.y-a.y : a.x-b.x).map(p=>p.text).join(" "));

    if (!date || !time || !isTaurine(title)) continue;

    const key = `${date}|${time}|${normalized(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      id: makeId(date, time, title),
      source: "Canal Extremadura",
      title,
      type: inferType(title),
      date,
      time,
      channel: "Canal Extremadura",
      location: "Televisión",
      breeding: "",
      participants: [],
      sourceUrl: pdfUrl,
      eventUrl: pdfUrl
    });
  }

  return events.sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
  );
}

export async function main(pdfOverride) {
let browser;

try {
  if (!pdfOverride) browser = await chromium.launch({ headless: true });
  const page = browser && await browser.newPage({
    locale: "es-ES",
    timezoneId: TIME_ZONE
  });

  const pdfUrl = pdfOverride || await findWeeklyPdf(page);
  const { items, pageText, edges } = await readPdf(pdfUrl);
  const dates = parseWeekDates(pdfUrl, pageText);
  const events = extractEvents(items, dates, pdfUrl, edges);

  const payload = {
    source: "Canal Extremadura",
    sourceUrl: pdfUrl,
    updatedAt: new Date().toISOString(),
    events
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`[Canal Extremadura] PDF: ${pdfUrl}`);
  console.log(`[Canal Extremadura] ${events.length} emisiones taurinas guardadas.`);

  for (const event of events) {
    console.log(`- ${event.date} ${event.time}: ${event.title}`);
  }
} catch (error) {
  console.error("[Canal Extremadura] Error:", error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
