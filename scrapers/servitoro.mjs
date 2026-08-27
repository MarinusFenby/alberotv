import fs from "node:fs/promises";
import crypto from "node:crypto";
import { chromium } from "playwright";

const SOURCE_URL =
  "https://www.servitoro.com/es/module/artdinamicacalendario/calendariotaurino";
const OUTPUT_FILE = "data/servitoro.json";

function normalizeSpaces(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeType(value = "") {
  const text = normalizeSpaces(value).toLowerCase();
  if (/rejones|rejoneo/.test(text)) return "Rejones";
  if (/novillada.*sin (picadores|caballos)/.test(text)) return "Novillada sin picadores";
  if (/novillada/.test(text)) return "Novillada con picadores";
  if (/recortadores|concurso de recortes|\brecortes\b/.test(text)) return "Recortes";
  if (/encierro/.test(text)) return "Encierro";
  if (/festival/.test(text)) return "Festival";
  if (/mixto/.test(text)) return "Festejo mixto";
  if (/corrida/.test(text)) return "Corrida de toros";
  return null;
}

function eventId(date, location, type) {
  return `servitoro-${crypto.createHash("sha1").update(`${date}|${location}|${type}`).digest("hex").slice(0, 14)}`;
}

function inferYear(month) {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  return now.getUTCFullYear() + (month < currentMonth - 6 ? 1 : 0);
}

function parseCalendar(text) {
  const compact = String(text).replace(/\r/g, "\n");
  const pattern = /(\d{1,2})[\/-](\d{1,2})(?:[\/-](20\d{2}))?\s+([^\n(]{2,90}?)\s*\((\d{1,2})[:.](\d{2})\)\s*([^\n]{2,100})/g;
  const events = [];
  const seen = new Set();
  for (const match of compact.matchAll(pattern)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3] || inferYear(month));
    const location = normalizeSpaces(match[4]);
    const type = normalizeType(match[7]);
    if (!type || !location || day < 1 || day > 31 || month < 1 || month > 12) continue;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const time = `${String(match[5]).padStart(2, "0")}:${match[6]}`;
    const key = `${date}|${location.toLowerCase()}|${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: eventId(date, location, type), date, time, location, type,
      channel: "Sin TV", televised: false, participants: [], breeding: null,
      sourceUrl: SOURCE_URL, confidence: 100, status: "confirmed"
    });
  }
  return events;
}

async function loadPageText() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: "es-ES" });
    await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    const title = await page.title();
    const text = await page.locator("body").innerText();
    if (/just a moment|attention required|cloudflare/i.test(`${title}\n${text}`)) {
      throw new Error("Servitoro ha presentado una comprobación anti-bot");
    }
    return text;
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const text = await loadPageText();
    const events = parseCalendar(text);
    if (!events.length) throw new Error("Servitoro no devolvió festejos reconocibles");
    const output = { source: "Servitoro", sourceUrl: SOURCE_URL, fetchedAt: new Date().toISOString(), events };
    await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Servitoro actualizado: ${events.length} festejos`);
  } catch (error) {
    // Regla de seguridad: una caída o bloqueo nunca sustituye el último catálogo válido.
    try {
      const previous = JSON.parse(await fs.readFile(OUTPUT_FILE, "utf8"));
      if (Array.isArray(previous.events) && previous.events.length) {
        console.warn(`Servitoro no actualizado; se conserva el último dato válido: ${error.message}`);
        return;
      }
    } catch {}
    throw error;
  }
}

await main();
