import { chromium } from "playwright";
import fs from "node:fs/promises";

const SOURCE_URL =
  "https://festejos.onetoro.tv/content/ultimos-dos-festejos";

const MONTHS = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8,
  octubre: 9, noviembre: 10, diciembre: 11
};

function clean(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function parseSpanishDate(text) {
  const normalized = clean(text).toLowerCase();

  // dd/mm/yyyy or dd-mm-yyyy
  let m = normalized.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  }

  // "11 de julio de 2026" or "11 julio 2026"
  m = normalized.match(
    /\b(\d{1,2})(?:\s+de)?\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+(\d{4})\b/
  );
  if (m) {
    return new Date(Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1])));
  }

  return null;
}

function parseTime(text) {
  const m = text.match(/\b([01]?\d|2[0-3])[:h.]([0-5]\d)\b/i);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

function isoDate(d) {
  return d ? d.toISOString().slice(0, 10) : null;
}

function inferTitle(text) {
  const candidates = [
    /((?:corrida|novillada|rejones|festival|encierro)[^.!|]{0,90})/i,
    /(feria[^.!|]{0,90})/i
  ];
  for (const rx of candidates) {
    const m = text.match(rx);
    if (m) return clean(m[1]);
  }
  return clean(text).slice(0, 120);
}

function inferLineup(text) {
  const markers = [" para ", " con ", " cartel "];
  const lower = text.toLowerCase();
  for (const marker of markers) {
    const i = lower.indexOf(marker);
    if (i >= 0) {
      const fragment = clean(text.slice(i + marker.length));
      if (fragment.length > 5) return fragment.slice(0, 220);
    }
  }
  return "";
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1600 },
    userAgent:
      "Mozilla/5.0 (compatible; AlberoTV/1.0; +programming-guide)"
  });

  await page.goto(SOURCE_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  // Give late client-side rendering a moment to settle.
  await page.waitForTimeout(2500);

  const extracted = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll("a")]
      .map((a) => ({
        href: a.href,
        text: (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim()
      }))
      .filter((x) => x.text || x.href);

    const candidates = [...document.querySelectorAll(
      "article, li, [class*='card'], [class*='item'], [class*='content'], section"
    )]
      .map((el) => ({
        text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
        links: [...el.querySelectorAll("a")].map((a) => a.href)
      }))
      .filter((x) => x.text.length >= 20 && x.text.length <= 1500);

    return {
      title: document.title,
      bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").trim(),
      anchors,
      candidates
    };
  });

  // Keep unique blocks and favor blocks that look like event information.
  const seen = new Set();
  const blocks = extracted.candidates
    .filter((x) => {
      const key = x.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return /202\d|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|corrida|novillada|rejones|feria/i.test(x.text);
    })
    .slice(0, 100);

  const events = blocks.map((block) => {
    const date = parseSpanishDate(block.text);
    return {
      date: isoDate(date),
      time: parseTime(block.text),
      title: inferTitle(block.text),
      lineup: inferLineup(block.text),
      channel: "OneToro",
      sourceUrl: block.links?.[0] || SOURCE_URL,
      sourceText: block.text
    };
  });

  // Remove obvious duplicate events.
  const unique = [];
  const keys = new Set();
  for (const event of events) {
    const key = `${event.date}|${event.time}|${event.title}`.toLowerCase();
    if (!keys.has(key)) {
      keys.add(key);
      unique.push(event);
    }
  }

  const result = {
    source: "OneToro",
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    pageTitle: extracted.title,
    events: unique,
    diagnostic: {
      anchorCount: extracted.anchors.length,
      candidateBlockCount: blocks.length
    }
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(
    "data/onetoro.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log(`OneToro: ${unique.length} candidatos guardados en data/onetoro.json`);
  await browser.close();
}

main().catch((error) => {
  console.error("Error al extraer OneToro:", error);
  process.exit(1);
});
