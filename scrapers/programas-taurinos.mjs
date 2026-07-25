import fs from "node:fs/promises";
import path from "node:path";

const VERSION = "2026-07-25-v5-corto";

const GUIDE_URL =
  "https://www.canalsur.es/guia-programacion/canal-sur-television-79/";

const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "data",
  "programas-taurinos.json"
);

const TITLE = "Toros para Todos";

function cleanHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getSpainDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date());
  const values = {};

  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day"
    ) {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function findTime(text) {
  const normalizedText = normalize(text);
  const normalizedTitle = normalize(TITLE);

  const titlePosition = normalizedText.indexOf(normalizedTitle);

  if (titlePosition === -1) {
    return "";
  }

  const nearbyText = normalizedText.slice(
    Math.max(0, titlePosition - 80),
    titlePosition + normalizedTitle.length + 80
  );

  const timeBefore = nearbyText.match(
    /([01]?\d|2[0-3])[:.]([0-5]\d)(?=[^0-9]{0,50}toros para todos)/
  );

  if (timeBefore) {
    return (
      String(timeBefore[1]).padStart(2, "0") +
      ":" +
      timeBefore[2]
    );
  }

  const timeAfter = nearbyText.match(
    /toros para todos[^0-9]{0,50}([01]?\d|2[0-3])[:.]([0-5]\d)/
  );

  if (timeAfter) {
    return (
      String(timeAfter[1]).padStart(2, "0") +
      ":" +
      timeAfter[2]
    );
  }

  return "";
}

async function main() {
  const response = await fetch(GUIDE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "es-ES,es;q=0.9"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Canal Sur respondió con HTTP ${response.status}`
    );
  }

  const html = await response.text();
  const text = cleanHtml(html);

  const date = getSpainDate();
  const present = normalize(text).includes(normalize(TITLE));
  const time = present ? findTime(text) : "";

  const events = [];

  if (time) {
    events.push({
      id:
        `toros-para-todos-${date}-` +
        time.replace(":", ""),

      source: "Canal Sur",
      title: "Toros para Todos",
      type: "Programa taurino",
      contentType: "programa",
      date,
      time,
      channel: "Canal Sur Televisión",
      location: "Televisión",
      breeding: "",
      participants: [],

      sourceUrl:
        "https://www.canalsur.es/television/toros-para-todos/",

      eventUrl:
        "https://www.canalsur.es/television/directo-television/"
    });
  }

  const output = {
    scraperVersion: VERSION,
    source: "Programas taurinos",
    updatedAt: new Date().toISOString(),
    timeZone: "Europe/Madrid",
    date,
    checked: 1,
    programsPresent: present ? 1 : 0,
    programsWithTime: time ? 1 : 0,
    emissionsFound: events.length,

    diagnostics: [
      {
        program: TITLE,
        source: "Canal Sur",
        guideUrl: GUIDE_URL,
        present,
        times: time ? [time] : [],
        eventsCreated: events.length
      }
    ],

    events
  };

  await fs.mkdir(
    path.dirname(OUTPUT_FILE),
    { recursive: true }
  );

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`Versión: ${VERSION}`);
  console.log(`Encontrado: ${present ? "sí" : "no"}`);
  console.log(`Hora: ${time || "no encontrada"}`);
  console.log(`Eventos: ${events.length}`);
}

main().catch(error => {
  console.error("ERROR:");
  console.error(error);
  process.exit(1);
});
