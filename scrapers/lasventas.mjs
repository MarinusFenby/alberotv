import fs from "node:fs/promises";
import crypto from "node:crypto";
import { chromium } from "playwright";

const INDEX_URL = "https://www.las-ventas.com/actualidad";
const OUTPUT_FILE = "data/lasventas.json";
const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4,
  mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10,
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
  const pageChrome = /(?:utilizamos cookies|cookies propias|de terceros para fines|fines anal[ií]ticos|publicidad personalizada|h[aá]bitos de navegaci[oó]n|p[aá]ginas visitadas|configurar tus preferencias|aceptar cookies|rechazar cookies|copyright|todos los derechos reservados|desarrollo por|pol[ií]tica de privacidad|aviso legal)/i;
  return [...new Set(clean(value)
    .replace(/[.]$/, "")
    .split(/\s*(?:,|;|·|\by\b)\s*/i)
    .map(clean)
    .filter(name => name.length > 2 && name.length <= 100 && !pageChrome.test(name)))];
}

function parseDetails(description = "") {
  const text = clean(description);
  const typeText = normalized(text);
  const type = typeText.includes("rejones")
    ? "Rejones"
    : typeText.includes("novillada")
      ? "Novillada"
      : "Corrida de toros";

  const match = text.match(/(?:toros?|novillos?)\s+de\s+(.+?)\s+para\s+(.+)$/i);
  return {
    type,
    breeding: match ? clean(match[1]) : "",
    participants: match ? splitNames(match[2].replace(/\s*\([^)]*\)\s*$/, "")) : []
  };
}

function extractEvents(text, sourceUrl) {
  const body = clean(text);
  const years = [...body.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
  const year = years.find(value => value >= new Date().getFullYear()) || new Date().getFullYear();
  const pattern = /(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\.?\s*(?:a\s+las\s+)?(\d{1,2})(?:[:.]?(\d{2}))?\s*h(?:oras?)?\.?\s*(.*?)(?=(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+\d{1,2}\s+de\s+|$)/gi;
  const events = [];

  for (const match of body.matchAll(pattern)) {
    const month = MONTHS[normalized(match[2])];
    if (!month) continue;
    const date = isoDate(Number(match[1]), month, year);
    const time = `${String(match[3]).padStart(2, "0")}:${match[4] || "00"}`;
    const description = clean(match[5]).split(/VENTA DE ENTRADAS|Los abonados|Durante todos|Utilizamos cookies|ACEPTAR COOKIES|RECHAZAR COOKIES|Copyright|Todos los derechos reservados|Política de privacidad|Aviso Legal/i)[0];
    const details = parseDetails(description);
    if (!details.participants.length && !details.breeding) continue;

    events.push({
      id: `lasventas-${idFor(`${date}|${time}|${description}`)}`,
      date,
      time,
      channel: "Sin TV",
      televised: false,
      televisionUnconfirmed: true,
      location: "Madrid (Plaza de Toros Monumental de Las Ventas)",
      name: "Madrid (Plaza de Toros Monumental de Las Ventas)",
      title: null,
      type: details.type,
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
    await page.goto(INDEX_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);

    const links = await page.locator('a[href*="/actualidad/"]').evaluateAll(nodes =>
      [...new Set(nodes.map(node => node.href))].slice(0, 40)
    );
    const candidateUrls = [...new Set([INDEX_URL, ...links])];
    const found = [];

    for (const url of candidateUrls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        const text = await page.locator("body").innerText({ timeout: 15000 });
        found.push(...extractEvents(text, url));
      } catch (error) {
        console.warn(`Las Ventas: no se pudo leer ${url}: ${error.message}`);
      }
    }

    const unique = new Map();
    for (const event of found) {
      const key = `${event.date}|${event.time}|${normalized(event.location)}`;
      const current = unique.get(key);
      if (!current || event.participants.length > current.participants.length) unique.set(key, event);
    }

    const events = [...unique.values()].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
    );
    if (!events.length) throw new Error("la web oficial no produjo ningún festejo");

    await fs.mkdir("data", { recursive: true });
    await fs.writeFile(OUTPUT_FILE, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      source: "Las Ventas oficial",
      sourceUrl: INDEX_URL,
      eventCount: events.length,
      events
    }, null, 2) + "\n", "utf8");
    console.log(`Las Ventas: ${events.length} festejos oficiales`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("Error en Las Ventas:", error);
  process.exitCode = 1;
});
