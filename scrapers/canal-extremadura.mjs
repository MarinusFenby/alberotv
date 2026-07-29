// scrapers/canalextremadura.mjs
// Extrae de la guía oficial de Canal Extremadura únicamente programación taurina.
// Salida: data/canalextremadura.json

import { chromium } from "playwright";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const SOURCE_URL = "https://www.canalextremadura.es/guia/television";
const OUTPUT_FILE = "data/canalextremadura.json";
const TIME_ZONE = "Europe/Madrid";

const TAURINE_TERMS = [
  "TOROS",
  "TAURINO",
  "TAURINA",
  "TIERRA DE TOROS",
  "CORRIDA",
  "NOVILLADA",
  "REJONES",
  "FESTEJO",
  "ENCIERRO",
  "CERTAMEN",
  "TROFEO DIPUTACIÓN",
  "TROFEO DIPUTACION"
];

function normalizeText(value = "") {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSearch(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

function isTaurine(title) {
  const normalized = normalizeForSearch(title);
  return TAURINE_TERMS.some((term) =>
    normalized.includes(normalizeForSearch(term))
  );
}

function madridDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function makeId(date, time, title) {
  const digest = crypto
    .createHash("sha1")
    .update(`${date}|${time}|${title}`)
    .digest("hex")
    .slice(0, 12);

  return `canal-extremadura-${date}-${time.replace(":", "")}-${digest}`;
}

function inferType(title) {
  const text = normalizeForSearch(title);

  if (text.includes("NOVILLADA CON PICADORES")) return "Novillada con picadores";
  if (text.includes("NOVILLADA")) return "Novillada";
  if (text.includes("CORRIDA DE REJONES") || text.includes("REJONES")) {
    return "Corrida de rejones";
  }
  if (text.includes("CORRIDA DE TOROS")) return "Corrida de toros";
  if (text.includes("ENCIERRO")) return "Encierro";
  if (text.includes("EXTREMADURA TIERRA DE TOROS") || text.includes("TIERRA DE TOROS")) {
    return "Programa taurino";
  }
  if (text === "TOROS" || text.startsWith("TOROS ")) return "Festejo taurino";

  return "Programa taurino";
}

async function extractSchedule(page) {
  return page.evaluate(() => {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    const clean = (text = "") =>
      text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const results = [];
    const seen = new Set();

    for (const element of document.querySelectorAll("body *")) {
      if (!visible(element)) continue;

      const ownText = clean(element.textContent);
      if (!timePattern.test(ownText)) continue;

      const time = ownText;
      let title = "";

      // Caso habitual: hora y título son hermanos dentro de una misma fila.
      const parent = element.parentElement;
      if (parent) {
        const siblings = [...parent.children]
          .filter((child) => child !== element && visible(child))
          .map((child) => clean(child.textContent))
          .filter(Boolean);

        title = siblings.join(" ");
      }

      // Segundo intento: buscar en el contenedor más cercano sin tragarnos media web.
      if (!title || title.length > 260) {
        let container = parent;
        for (let level = 0; container && level < 4; level += 1) {
          const text = clean(container.textContent)
            .replace(new RegExp(`^${time}\\s*`), "")
            .trim();

          if (text && text.length <= 260) {
            title = text;
            break;
          }

          container = container.parentElement;
        }
      }

      title = clean(title)
        .replace(new RegExp(`^${time}\\s*`), "")
        .replace(/\bDescargar parrilla\b/gi, "")
        .trim();

      if (!title || title === time || title.length > 260) continue;

      const key = `${time}|${title}`;
      if (seen.has(key)) continue;

      seen.add(key);
      results.push({ time, title });
    }

    return results;
  });
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    locale: "es-ES",
    timezoneId: TIME_ZONE,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });

  await page.goto(SOURCE_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(2500);

  const date = madridDateISO();
  const fullSchedule = await extractSchedule(page);

  const events = fullSchedule
    .filter((item) => isTaurine(item.title))
    .map((item) => {
      const title = normalizeText(item.title);

      return {
        id: makeId(date, item.time, title),
        source: "Canal Extremadura",
        title,
        type: inferType(title),
        date,
        time: item.time,
        channel: "Canal Extremadura",
        location: "Televisión",
        breeding: "",
        participants: [],
        sourceUrl: SOURCE_URL,
        eventUrl: SOURCE_URL
      };
    })
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const payload = {
    source: "Canal Extremadura",
    sourceUrl: SOURCE_URL,
    updatedAt: new Date().toISOString(),
    events
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    `[Canal Extremadura] ${fullSchedule.length} espacios revisados; ` +
    `${events.length} eventos taurinos guardados en ${OUTPUT_FILE}.`
  );
} catch (error) {
  console.error("[Canal Extremadura] Error:", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
