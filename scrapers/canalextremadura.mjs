// scrapers/canalextremadura.mjs
// Extrae la programación taurina de la parrilla semanal oficial de Canal Extremadura.
// Requiere: npm install playwright pdfjs-dist
// Genera: data/canalextremadura.json

import { chromium } from "playwright";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs/promises";
import crypto from "node:crypto";

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

  // Corrige semanas que cruzan de diciembre a enero.
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
  if (!match) return null;
  return `${pad(Number(match[1]))}:${match[2]}`;
}

async function findWeeklyPdf(page) {
  await page.goto(GUIDE_URL, { waitUntil: "networkidle", timeout: 90000 });

  const href = await page.locator('a:has-text("Descargar parrilla")').first().getAttribute("href");
  if (!href) throw new Error("No se encontró el enlace «Descargar parrilla».");

  return new URL(href, GUIDE_URL).href;
}

async function readPdf(pdfUrl) {
  const response = await fetch(pdfUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar el PDF (${response.status}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
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
    pageText: items.map((item) => item.text).join(" ")
  };
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
    .filter((item) => dayWords.some((day) => normalized(item.text).startsWith(day.toUpperCase())))
    .sort((a, b) => a.x - b.x);

  if (headers.length >= 7) {
    return headers.slice(0, 7).map((item) => item.x + item.width / 2);
  }

  // Plan B: usa el ancho ocupado por la tabla, dejando fuera las horas laterales.
  const xs = items.map((item) => item.x).sort((a, b) => a - b);
  const minX = xs[Math.floor(xs.length * 0.08)];
  const maxX = xs[Math.floor(xs.length * 0.92)];
  const columnWidth = (maxX - minX) / 7;

  return Array.from({ length: 7 }, (_, index) => minX + columnWidth * (index + 0.5));
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

function eventTimeForY(timeRows, y) {
  if (!timeRows.length) return "";

  let best = timeRows[0];
  let bestDistance = Math.abs(best.y - y);

  for (const row of timeRows) {
    const distance = Math.abs(row.y - y);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }

  return best.time;
}

function collectEventTitle(items, columnCenters, columnIndex, keywordItem) {
  const centers = columnCenters;
  const assigned = items
    .filter((item) => {
      const center = item.x + item.width / 2;
      return nearestIndex(centers, center) === columnIndex;
    })
    .filter((item) => Math.abs(item.y - keywordItem.y) <= 45)
    .filter((item) => !parseTime(item.text))
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 2) return b.y - a.y;
      return a.x - b.x;
    });

  const title = clean(assigned.map((item) => item.text).join(" "));

  // Evita títulos gigantes si el PDF agrupa demasiadas piezas cercanas.
  const words = title.split(" ");
  return words.slice(0, 35).join(" ");
}

function extractEvents(items, dates, pdfUrl) {
  const columnCenters = detectDayColumns(items);
  const timeRows = detectTimeRows(items, columnCenters);
  const events = [];
  const seen = new Set();

  for (const item of items) {
    if (!isTaurine(item.text)) continue;

    const itemCenter = item.x + item.width / 2;
    const dayIndex = nearestIndex(columnCenters, itemCenter);

    if (dayIndex < 0 || dayIndex > 6) continue;

    const date = dates[dayIndex];
    const time = eventTimeForY(timeRows, item.y);
    const title = collectEventTitle(items, columnCenters, dayIndex, item);

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

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    locale: "es-ES",
    timezoneId: TIME_ZONE
  });

  const pdfUrl = await findWeeklyPdf(page);
  const { items, pageText } = await readPdf(pdfUrl);
  const dates = parseWeekDates(pdfUrl, pageText);
  const events = extractEvents(items, dates, pdfUrl);

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
  await browser.close();
}
