import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const SOURCE_URL =
  "https://www.aplausos.es/esta-es-la-programacion-taurina-en-television/";
const OUTPUT_FILE = "data/aplausos.json";

const MONTHS = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05",
  junio: "06", julio: "07", agosto: "08", septiembre: "09",
  setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12"
};

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&nbsp;|&ensp;|&emsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í").replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í").replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ");
}

function clean(value = "") {
  return decodeHtmlEntities(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalized(value = "") {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function htmlToText(html = "") {
  return clean(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " "));
}

function idFor(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 14);
}

function channelFrom(value = "") {
  const text = normalized(value);
  if (text.includes("onetoro")) return "OneToro";
  if (text.includes("canal sur")) return "Canal Sur";
  if (text.includes("canal extremadura")) return "Canal Extremadura";
  if (text.includes("castilla la mancha") || text.includes("cmmedia")) return "CMM";
  if (text.includes("telemadrid")) return "Telemadrid";
  if (text.includes("a punt")) return "À Punt";
  if (text.includes("castilla y leon") || text.includes("la 7")) return "La 7 CyL";
  if (text.includes("rtve") || text.includes("la 2 de tve")) return "RTVE";
  return "";
}

function splitNames(value = "") {
  return [...new Set(clean(value)
    .replace(/[.]$/, "")
    .split(/\s*(?:,|;|·|\by\b)\s*/i)
    .map(name => clean(name).replace(/^(?:el|la|los|las)\s+(?:rejoneador(?:a)?|novilleros?|matadores?)\s+/i, ""))
    .filter(name => name.length > 2))];
}

function typeFrom(value = "") {
  const text = normalized(value);
  if (text.includes("novillada") || text.includes("novillos")) return "Novillada";
  if (text.includes("rejones") || text.includes("rejoneo")) return "Rejones";
  if (text.includes("recortes") || text.includes("recortadores")) return "Recortes";
  return "Corrida de toros";
}

function detailsFrom(value = "") {
  const text = clean(value);
  const match = text.match(/(?:toros?|novillos?|astados|reses)\s+de\s+(.+?)\s+para\s+(.+?)(?=(?:\.|\s+\(?Pulse aqu[ií])|$)/i);
  return {
    breeding: match ? clean(match[1]) : "",
    participants: match ? splitNames(match[2]) : []
  };
}

function extractYear(html = "") {
  const explicit = clean(html).match(/(?:datePublished|article:published_time)[^>]{0,160}?\b(20\d{2})\b/i);
  if (explicit) return Number(explicit[1]);
  const years = [...htmlToText(html).matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
  return years.find(year => year >= new Date().getUTCFullYear()) || new Date().getUTCFullYear();
}

export function extractEvents(html = "") {
  const text = htmlToText(html);
  const year = extractYear(html);
  const entryPattern = /(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\.\s*([^.]{2,80})\.\s*([^.]{2,120})\.\s*(\d{1,2})[:.]?(\d{2})\s*horas?\.\s*(.*?)(?=(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+\d{1,2}\s+de\s+|M[aá]s toros en los programas semanales|$)/gi;
  const events = [];

  for (const match of text.matchAll(entryPattern)) {
    const month = MONTHS[normalized(match[2])];
    const channel = channelFrom(match[3]);
    if (!month || !channel) continue;

    const date = `${year}-${month}-${String(match[1]).padStart(2, "0")}`;
    const time = `${String(match[5]).padStart(2, "0")}:${match[6]}`;
    const location = clean(match[4]);
    const description = clean(match[7]);
    const details = detailsFrom(description);

    events.push({
      id: `aplausos-${idFor(`${date}|${time}|${location}|${channel}`)}`,
      date,
      time,
      channel,
      deferred: /\ben\s+diferido\b/i.test(description),
      televised: true,
      location,
      name: location,
      title: null,
      type: typeFrom(description),
      contentType: "festejo",
      breeding: details.breeding,
      participants: details.participants,
      eventUrl: SOURCE_URL,
      sourceUrl: SOURCE_URL
    });
  }

  return events;
}

async function main() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AlberoTV/1.0)",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const found = extractEvents(html);
  const unique = new Map();
  for (const event of found) {
    const key = `${event.date}|${event.time}|${normalized(event.location)}|${event.channel}`;
    unique.set(key, event);
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const events = [...unique.values()]
    .filter(event => event.date >= cutoff.toISOString().slice(0, 10))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  if (!events.length) throw new Error("la agenda no produjo emisiones vigentes");

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    source: "Aplausos",
    sourceUrl: SOURCE_URL,
    eventCount: events.length,
    events
  }, null, 2) + "\n", "utf8");
  console.log(`Aplausos: ${events.length} emisiones taurinas`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Error en Aplausos:", error);
    process.exitCode = 1;
  });
}
