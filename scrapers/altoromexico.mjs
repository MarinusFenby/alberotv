import fs from "node:fs/promises";
import crypto from "node:crypto";

// Al Toro México: cartelera estructurada de festejos en México.
// Prioridad: debajo de las fuentes oficiales de plaza/empresa y por encima de
// Mundotoro y Toros en el Mundo. La hora publicada es la hora local de la
// plaza; se guarda con su zona IANA y nunca en el campo `time` (hora de Madrid).
// robots.txt pide 10 s entre peticiones: el scraper hace una sola petición.

export const SOURCE_NAME = "Al Toro México";
export const SOURCE_URL = "https://www.altoromexico.com/index.php?acc=carteleria";
const OUTPUT_FILE = "data/altoromexico.json";

const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü" };

export function normalizeKey(value = "") {
  return String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&([aeiouAEIOU])(acute|grave);/g, (_, letter, accent) =>
      (letter + (accent === "acute" ? "́" : "̀")).normalize("NFC"))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => ENTITIES[name] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Zonas IANA de México (tzdata 2022+, sin horario de verano salvo la franja
 * fronteriza). Un estado con varias zonas solo se resuelve si el municipio es
 * conocido; si no, la hora queda para revisión en lugar de adivinarse.
 */
const STATE_ALIASES = {
  ags: "aguascalientes", cdmx: "ciudad de mexico", "distrito federal": "ciudad de mexico", df: "ciudad de mexico",
  "estado de mexico": "mexico", edomex: "mexico", "edo mex": "mexico", "edo de mexico": "mexico",
  "nuevo leon": "nuevo leon", nl: "nuevo leon", qro: "queretaro", slp: "san luis potosi", "san luis": "san luis potosi",
  gto: "guanajuato", jal: "jalisco", hgo: "hidalgo", tlax: "tlaxcala", zac: "zacatecas", yuc: "yucatan",
  mich: "michoacan", "michoacan de ocampo": "michoacan", "veracruz de ignacio de la llave": "veracruz",
  "coahuila de zaragoza": "coahuila", qroo: "quintana roo", bcs: "baja california sur", bc: "baja california"
};
const STATE_ZONE = {
  aguascalientes: "America/Mexico_City", "ciudad de mexico": "America/Mexico_City", mexico: "America/Mexico_City",
  colima: "America/Mexico_City", chiapas: "America/Mexico_City", guanajuato: "America/Mexico_City",
  guerrero: "America/Mexico_City", hidalgo: "America/Mexico_City", jalisco: "America/Mexico_City",
  michoacan: "America/Mexico_City", morelos: "America/Mexico_City", oaxaca: "America/Mexico_City",
  puebla: "America/Mexico_City", queretaro: "America/Mexico_City", "san luis potosi": "America/Mexico_City",
  tabasco: "America/Mexico_City", tlaxcala: "America/Mexico_City", veracruz: "America/Mexico_City",
  zacatecas: "America/Mexico_City",
  durango: "America/Monterrey",
  campeche: "America/Merida", yucatan: "America/Merida",
  "quintana roo": "America/Cancun",
  sinaloa: "America/Mazatlan", "baja california sur": "America/Mazatlan",
  sonora: "America/Hermosillo",
  "baja california": "America/Tijuana"
};
// Estados divididos: zona por defecto + municipios con otra zona.
const SPLIT_STATES = {
  tamaulipas: { zone: "America/Monterrey", exceptions: { "America/Matamoros": [
    "nuevo laredo", "reynosa", "matamoros", "rio bravo", "valle hermoso", "camargo", "guerrero", "mier",
    "miguel aleman", "gustavo diaz ordaz"] } },
  coahuila: { zone: "America/Monterrey", exceptions: { "America/Matamoros": [
    "acuna", "ciudad acuna", "allende", "guerrero", "hidalgo", "jimenez", "morelos", "nava", "ocampo",
    "piedras negras", "villa union", "zaragoza"] } },
  "nuevo leon": { zone: "America/Monterrey", exceptions: { "America/Matamoros": ["anahuac"] } },
  chihuahua: { zone: "America/Chihuahua", exceptions: {
    "America/Ciudad_Juarez": ["juarez", "ciudad juarez"],
    "America/Ojinaga": ["ojinaga", "ascension", "coyame del sotol", "guadalupe", "manuel benavides", "praxedis g guerrero"] } },
  nayarit: { zone: "America/Mazatlan", exceptions: { "America/Bahia_Banderas": ["bahia de banderas"] } }
};

export function canonicalState(state = "") {
  const key = normalizeKey(state);
  return STATE_ALIASES[key] || key;
}

/** Zona IANA de una plaza mexicana, o null si no puede determinarse con seguridad. */
export function mexicoTimeZone(town = "", state = "") {
  const stateKey = canonicalState(state);
  if (STATE_ZONE[stateKey]) return STATE_ZONE[stateKey];
  const split = SPLIT_STATES[stateKey];
  if (!split) return null;
  const townKey = normalizeKey(town);
  for (const [zone, towns] of Object.entries(split.exceptions)) {
    if (towns.includes(townKey)) return zone;
  }
  return split.zone;
}

const STATE_NAMES = {
  "ciudad de mexico": "Ciudad de México", mexico: "Estado de México", "nuevo leon": "Nuevo León",
  "san luis potosi": "San Luis Potosí", michoacan: "Michoacán", queretaro: "Querétaro", yucatan: "Yucatán",
  "baja california": "Baja California", "baja california sur": "Baja California Sur", "quintana roo": "Quintana Roo"
};
function stateLabel(state) {
  const key = canonicalState(state);
  if (STATE_NAMES[key]) return STATE_NAMES[key];
  return key.replace(/\b\p{L}/gu, letter => letter.toUpperCase());
}

/** «Guadalajara, Jalisco» · «Plaza "San Marcos" de Aguascalientes, Ags.» */
export function parsePlace(text = "") {
  const value = decodeHtml(text).replace(/\.$/, "");
  const comma = value.lastIndexOf(",");
  if (comma < 0) return { town: value, state: null, plaza: null };
  let town = value.slice(0, comma).trim();
  const state = value.slice(comma + 1).trim() || null;
  // «Plaza "San Marcos" de Aguascalientes» es la plaza de la ciudad.
  const plaza = town.match(/^plaza(?: de toros)?\s+["“]([^"”]+)["”]\s+de\s+(.+)$/i);
  if (plaza) return { town: plaza[2].trim(), state, plaza: plaza[1].trim() };
  return { town, state, plaza: null };
}

/**
 * «6 Ordaz 6» → 6 reses de Ordaz · «1 Zacatepec | 6 Caparica» → 7 reses de dos
 * hierros · «4 José Garfias 4 (2 novillos)» → 4 reses · «Diferentes
 * ganaderías» / «por definir» → sin ganadería.
 */
export function parseCattle(text = "") {
  const value = decodeHtml(text).replace(/\s*\([^)]*\)\s*$/, "");
  let count = 0;
  const names = [];
  for (const piece of value.split(/\s*\|\s*/).filter(Boolean)) {
    const match = piece.match(/^(\d{1,2})\s+(.+?)(?:\s+(\d{1,2}))?$/);
    if (match && (!match[3] || match[3] === match[1])) {
      count += Number(match[1]);
      names.push(match[2].trim());
    } else {
      // «6 Cuatro Caminos | José Barba 6»: el número final cierra el lote.
      names.push(piece.replace(/\s+\d{1,2}$/, "").trim());
    }
  }
  const known = names.filter(name => name && !/diferentes ganader|por (definir|designar)/i.test(name));
  return { breeding: known.join(", "), cattleCount: count || null };
}

function cleanParticipant(name = "") {
  return decodeHtml(name).replace(/["“”«»]/g, "").replace(/\s+/g, " ").trim();
}

const GENERIC_PARTICIPANTS = /^(triunfadores?( del ciclo| de la temporada)?|por (definir|designar)|alumnos?\b.*)$/i;

function festejoType(title = "") {
  const value = normalizeKey(title);
  if (/festival/.test(value)) return "Festival";
  if (/mixt/.test(value)) return "Festejo mixto";
  if (/rejon/.test(value)) return "Rejones";
  if (/novillada/.test(value)) return "Novillada";
  if (/corrida|festejo/.test(value)) return "Corrida de toros";
  return "Festejo taurino";
}

function eventId(date, town, state, type) {
  return `altoromexico-${crypto.createHash("sha1").update(`${date}|${normalizeKey(town)}|${canonicalState(state || "")}|${type}`).digest("hex").slice(0, 14)}`;
}

/** Tarjetas de la cartelera → eventos normalizados para merge.mjs. */
export function parseCarteleria(html = "", { fetchedAt = null } = {}) {
  const events = [];
  const blocks = String(html).split(/<div class="fecha-festejo">/i).slice(1);
  for (const block of blocks) {
    const dateText = decodeHtml(block.slice(0, block.search(/<div class="row"/i)));
    const dateMatch = dateText.match(/(\d{1,2})\s+([a-zA-Z]{3})[a-zA-Z]*\.?\s+(20\d{2})\s*,\s*(?:(\d{1,2}):(\d{2})\s*horas)?/);
    const month = dateMatch && MONTHS[normalizeKey(dateMatch[2])];
    if (!dateMatch || !month) continue;
    const date = `${dateMatch[3]}-${String(month).padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
    const hour = dateMatch[4] !== undefined ? Number(dateMatch[4]) : null;
    const localTime = hour !== null && hour < 24 ? `${String(hour).padStart(2, "0")}:${dateMatch[5]}` : null;

    const cattleHtml = (block.match(/<br\s*\/?>\s*([^<]*?)\s*<div class="lugar-festejo">/i) || [])[1] || "";
    const placeHtml = (block.match(/class="lugar-festejo">([\s\S]*?)<\/div>/i) || [])[1] || "";
    const titleHtml = (block.match(/font-weight:\s*700[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "";
    const participants = [...block.matchAll(/class="torero">([\s\S]*?)<\/div>/gi)]
      .map(match => cleanParticipant(match[1]))
      .filter(name => name && !GENERIC_PARTICIPANTS.test(name));

    const { town, state, plaza } = parsePlace(placeHtml);
    if (!town) continue;
    const title = decodeHtml(titleHtml);
    const type = festejoType(title);
    const { breeding, cattleCount } = parseCattle(cattleHtml);
    const zone = state ? mexicoTimeZone(town, state) : null;
    const location = state ? `${town} (${stateLabel(state)}) México` : `${town} México`;

    const event = {
      id: eventId(date, town, state, type),
      date,
      time: null,
      channel: "Sin TV",
      televised: false,
      location,
      name: location,
      country: "México",
      type,
      contentType: "festejo",
      breeding,
      participants,
      title: null,
      sourceDescription: title || null,
      image: null,
      eventUrl: SOURCE_URL,
      sourceUrl: SOURCE_URL,
      fieldSources: { type: SOURCE_NAME }
    };
    if (cattleCount) event.cattleCount = cattleCount;
    if (plaza) event.plaza = plaza;
    if (localTime && zone) {
      Object.assign(event, { sourceLocalDate: date, sourceLocalTime: localTime, sourceTimeZone: zone });
      event.fieldSources.localTime = SOURCE_NAME;
    } else if (localTime) {
      // Hora publicada sin zona segura: se conserva para revisión, no se publica.
      event.localTimeReview = { date, time: localTime, state, reason: "timezone_unknown" };
    }
    if (fetchedAt) event.fetchedAt = fetchedAt;
    events.push(event);
  }
  return events;
}

async function main() {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)" },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Al Toro México HTTP ${response.status}`);
  // La página se sirve en ISO-8859-1.
  const html = new TextDecoder("latin1").decode(await response.arrayBuffer());
  const fetchedAt = new Date().toISOString();
  const events = parseCarteleria(html, { fetchedAt });
  if (!events.length) throw new Error("Al Toro México: cartelera sin festejos");
  const output = { source: SOURCE_NAME, sourceUrl: SOURCE_URL, fetchedAt, eventCount: events.length, events };
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Al Toro México: ${events.length} festejos`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
