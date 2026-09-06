import fs from "node:fs/promises";
import crypto from "node:crypto";

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

export function parseDetails(description = "") {
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

export function extractEvents(text, sourceUrl) {
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

export function extractEventsFromBlocks(blocks = [], sourceUrl) {
  return blocks.flatMap(block => {
    const standard = extractEvents(block, sourceUrl);
    if (standard.length) return standard;
    const value = clean(block);
    const year = Number(value.match(/\b(20\d{2})\b/)?.[1] || new Date().getFullYear());
    const identity = value.match(/^(.{5,180}?)\s+son\s+los\s+(?:tres|\d+)\s+nombres?\s+protagonistas?/i);
    const date = value.match(/\bcita\s+de\s+(?:este\s+\w+,?\s*)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i) ||
      value.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i);
    const time = value.match(/\ba\s+las\s+(\d{1,2})(?:[:.]?(\d{2}))?\s*h/i);
    const breeding = value.match(/\b(?:lidiar|lidiar[aá]n)\s+toros\s+de\s+([^.;]+?)(?:\.|,|$)/i);
    if (!identity || !date || !time || !breeding) return [];
    const participants = splitNames(identity[1].replace(/^.*?\b20\d{2}\s+/, ""));
    if (participants.length < 1 || participants.length > 6) return [];
    const iso = isoDate(Number(date[1]), MONTHS[normalized(date[2])], year);
    const clock = `${String(time[1]).padStart(2, "0")}:${time[2] || "00"}`;
    return [{ id: `lasventas-${idFor(`${iso}|${clock}|${participants.join("|")}`)}`,
      date: iso, time: clock, channel: "Sin TV", televised: false,
      televisionUnconfirmed: true, location: "Madrid (Plaza de Toros Monumental de Las Ventas)",
      name: "Madrid (Plaza de Toros Monumental de Las Ventas)", title: null,
      type: "Corrida de toros", contentType: "festejo", breeding: clean(breeding[1]),
      participants, eventUrl: sourceUrl, sourceUrl }];
  });
}

async function main() {
  const { chromium } = await import("playwright");
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
        const blocks = await page.locator("article, main .views-row, main .card, main [class*='noticia'], main [class*='event']")
          .allTextContents({ timeout: 15000 });
        // Cada bloque se procesa de forma aislada: una captura nunca puede
        // atravesar otro artículo, la navegación, la paginación o el footer.
        const isolated = blocks.map(clean).filter(value => value.length >= 20);
        if (!isolated.length && url !== INDEX_URL) {
          const mainText = await page.locator("main").innerText({ timeout: 15000 });
          isolated.push(clean(mainText));
        }
        found.push(...extractEventsFromBlocks(isolated, url));
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => {
    console.error("Error en Las Ventas:", error);
    process.exitCode = 1;
  });
}
