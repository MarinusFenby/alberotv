import fs from "node:fs/promises";
import crypto from "node:crypto";
import { chromium } from "playwright";

const HOME_URL = "https://vadetoros.es/";
const AGENDA_URL =
  "https://vadetoros.es/agenda-de-toros-en-television-para-el-fin-de-semana-del-27-de-febrero-al-1-de-marzo-de-2026/";
const OUTPUT_FILE = "data/vadetoros.json";

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12
};

function clean(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalized(value = "") {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function idFor(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 14);
}

function isoDate(day, month, year) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function splitNames(value = "") {
  return [...new Set(clean(value)
    .replace(/[.]$/, "")
    .split(/\s*(?:,|;|·|\by\b)\s*/i)
    .map(clean)
    .filter(name => name.length > 2))];
}

function channelFrom(text = "") {
  const value = normalized(text);
  if (value.includes("onetoro") || value.includes("one toro")) return "OneToro";
  if (value.includes("canal sur")) return "Canal Sur";
  if (value.includes("canal extremadura")) return "Canal Extremadura";
  if (value.includes("cmmedia") || /\bcmm\b/.test(value)) return "CMM";
  if (value.includes("telemadrid") || value.includes("tlmad1")) return "Telemadrid";
  if (value.includes("toros en espana play")) return "Toros en España Play";
  if (value.includes("castilla y leon") || value.includes("la 7 cyl")) return "La 7 CyL";
  if (value.includes("a punt") || value.includes("apunt")) return "À Punt";
  if (value.includes("rtve") || value.includes("playtoros")) return "RTVE";
  return "";
}

function typeFrom(text = "") {
  const value = normalized(text);
  if (value.includes("rejones") || value.includes("rejoneo")) return "Rejones";
  if (value.includes("novillada") || value.includes("novillos")) return "Novillada";
  if (value.includes("recortes") || value.includes("recortadores")) return "Recortes";
  return "Corrida de toros";
}

function detailsFrom(text = "") {
  const value = clean(text);
  const match = value.match(/(?:toros?|novillos?|astados|reses)\s+de\s+(.+?)\s+para\s+(.+?)(?=(?:\.|\s+(?:OneToro|Canal Sur|Canal Extremadura|CMM(?:edia)?|Telemadrid|TLMad1|Toros en Espa[nñ]a Play|La 7 CyL|RTVE|À Punt|A Punt))|$)/i);
  return {
    breeding: match ? clean(match[1]) : "",
    participants: match ? splitNames(match[2]) : []
  };
}

function extractEvents(text, sourceUrl) {
  const body = clean(text);
  const now = new Date();
  const pageYears = [...body.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
  const defaultYear = pageYears.find(year => year >= now.getUTCFullYear()) || now.getUTCFullYear();
  const entryPattern = /(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s*\((\d{1,2})[:.]?(\d{2})\)\s*(.*?)(?=(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+\d{1,2}\s+de\s+|$)/gi;
  const events = [];

  for (const match of body.matchAll(entryPattern)) {
    const month = MONTHS[normalized(match[2])];
    if (!month) continue;

    let year = defaultYear;
    if (month < now.getUTCMonth() + 1 - 6) year += 1;
    const date = isoDate(Number(match[1]), month, year);
    const time = `${String(match[3]).padStart(2, "0")}:${match[4]}`;
    const description = clean(match[5]);
    const channel = channelFrom(description);
    if (!channel) continue;

    const firstPeriod = description.indexOf(".");
    let location = clean(firstPeriod >= 0 ? description.slice(0, firstPeriod) : description)
      .replace(/^[–—:-]+\s*/, "");
    // Algunos titulares empiezan por la plaza y continúan con feria, ganado y
    // cartel. Solo la primera parte es la ubicación que debe mostrar la app.
    const locationInHeadline = location.match(/^([^,]+),\s*(?:feria\b|corrida\b|toros?\s+de\b|novillos?\s+de\b)/i);
    if (locationInHeadline) location = clean(locationInHeadline[1]);
    const locationBeforeDescription = location.match(
      /^(.+?\([^)]*\))\s+(?:[IVXLCDM]+\s+certamen\b|corrida\b|novillada\b|feria\b)/i
    );
    if (locationBeforeDescription) location = clean(locationBeforeDescription[1]);
    if (!location || location.length > 100) continue;

    const details = detailsFrom(description);
    const type = typeFrom(description);
    events.push({
      id: `vadetoros-${idFor(`${date}|${time}|${location}|${channel}`)}`,
      date,
      time,
      channel,
      televised: true,
      location,
      name: location,
      title: null,
      type,
      contentType: "festejo",
      breeding: details.breeding,
      participants: details.participants,
      eventUrl: sourceUrl,
      sourceUrl
    });
  }

  return events;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: "es-ES", timezoneId: "Europe/Madrid" });
    const page = await context.newPage();
    const candidateUrls = new Set([AGENDA_URL]);

    try {
      await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      const discovered = await page.locator('a[href*="agenda-de-toros-en-television"]').evaluateAll(nodes =>
        [...new Set(nodes.map(node => node.href))]
      );
      discovered.forEach(url => candidateUrls.add(url));
    } catch (error) {
      console.warn(`Va de Toros: no se pudo descubrir la agenda: ${error.message}`);
    }

    const found = [];
    for (const url of candidateUrls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        const text = await page.locator("body").innerText({ timeout: 15000 });
        found.push(...extractEvents(text, url));
      } catch (error) {
        console.warn(`Va de Toros: no se pudo leer ${url}: ${error.message}`);
      }
    }

    const unique = new Map();
    for (const event of found) {
      const key = `${event.date}|${event.time}|${normalized(event.location)}`;
      const current = unique.get(key);
      if (!current || event.participants.length > current.participants.length) unique.set(key, event);
    }

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 7);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const events = [...unique.values()]
      .filter(event => event.date >= cutoffDate)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    if (!events.length) throw new Error("la agenda no produjo emisiones vigentes");

    await fs.mkdir("data", { recursive: true });
    await fs.writeFile(OUTPUT_FILE, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      source: "Va de Toros",
      sourceUrl: AGENDA_URL,
      eventCount: events.length,
      events
    }, null, 2) + "\n", "utf8");
    console.log(`Va de Toros: ${events.length} emisiones taurinas`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("Error en Va de Toros:", error);
  process.exitCode = 1;
});
