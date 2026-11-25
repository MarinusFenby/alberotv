import fs from "node:fs/promises";
import path from "node:path";
import { preserveGuideOnFailure } from './guide-result.mjs';

const SOURCE = "CMM";
const GUIDE_URL = "https://www.cmmedia.es/programacion/tv";
const OUTPUT = path.resolve("data/cmm.json");

const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)";

function normalizeSpace(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value = "") {
  const entities = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    ntilde: "ñ",
    Ntilde: "Ñ"
  };

  return String(value)
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&([a-zA-Z]+);/g, (whole, name) =>
      Object.hasOwn(entities, name) ? entities[name] : whole
    );
}

function stripHtml(value = "") {
  return normalizeSpace(
    decodeHtml(
      String(value)
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function absoluteUrl(value = "") {
  try {
    return new URL(decodeHtml(value), GUIDE_URL).href;
  } catch {
    return GUIDE_URL;
  }
}

function isoDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function normalizeWeekday(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function weekdayNumber(value = "") {
  return {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6
  }[normalizeWeekday(value)];
}

function extractDateHeaders(html) {
  /*
   * La cabecera de CMM contiene una secuencia como:
   * martes 21 miércoles 22 ... martes 04
   */
  const text = stripHtml(html);
  const matches = [
    ...text.matchAll(
      /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})\b/gi
    )
  ];

  const headers = [];
  const seenSequence = new Set();

  for (const match of matches) {
    const weekday = normalizeWeekday(match[1]);
    const day = Number(match[2]);
    const key = `${weekday}-${day}`;

    /*
     * La misma cabecera puede aparecer más de una vez en el HTML.
     * Nos quedamos con la primera secuencia de días distintos.
     */
    if (seenSequence.has(key)) {
      if (headers.length >= 7) break;
      continue;
    }

    headers.push({
      weekday,
      weekdayNumber: weekdayNumber(weekday),
      day
    });
    seenSequence.add(key);

    if (headers.length >= 15) break;
  }

  return headers;
}

function resolveHeaderDates(headers, now = new Date()) {
  if (!headers.length) return [];

  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));

  /*
   * Buscamos qué fecha real corresponde al primer día de la cabecera.
   * La parrilla suele cubrir aproximadamente una semana pasada y otra futura.
   */
  for (let offset = -30; offset <= 30; offset++) {
    const candidate = addUtcDays(today, offset);

    if (
      candidate.getUTCDate() !== headers[0].day ||
      candidate.getUTCDay() !== headers[0].weekdayNumber
    ) {
      continue;
    }

    let valid = true;

    for (let index = 0; index < headers.length; index++) {
      const date = addUtcDays(candidate, index);
      const header = headers[index];

      if (
        date.getUTCDate() !== header.day ||
        date.getUTCDay() !== header.weekdayNumber
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      return headers.map((_, index) =>
        isoDate(addUtcDays(candidate, index))
      );
    }
  }

  return [];
}

function extractClassContent(fragment, className, tagPattern = "[a-z0-9]+") {
  const pattern = new RegExp(
    `<${tagPattern}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tagPattern}>`,
    "i"
  );

  const match = fragment.match(pattern);
  return match ? match[1] : "";
}

function extractEvents(html) {
  /*
   * Cada emisión comienza exactamente con:
   * <p class="c-event__hour">HH:MM</p>
   *
   * Cortamos desde una hora hasta la siguiente. Así no dependemos
   * del nombre de la etiqueta contenedora.
   */
  const hourPattern =
    /<p\b[^>]*class=["'][^"']*\bc-event__hour\b[^"']*["'][^>]*>\s*([0-2]?\d:[0-5]\d)\s*<\/p>/gi;

  const matches = [...html.matchAll(hourPattern)];
  const events = [];

  for (let index = 0; index < matches.length; index++) {
    const start = matches[index].index;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index
        : html.length;

    const fragment = html.slice(start, end);
    const rawTime = matches[index][1];
    const [hour, minute] = rawTime.split(":").map(Number);

    if (hour > 23) continue;

    const time =
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    const titleHtml = extractClassContent(
      fragment,
      "c-event__title",
      "h[1-6]"
    );

    const titleLink = titleHtml.match(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );

    const title = stripHtml(titleLink?.[2] || titleHtml);
    if (!title) continue;

    const subtitleHtml = extractClassContent(
      fragment,
      "c-event__subtitle",
      "p"
    );

    const description = stripHtml(subtitleHtml);

    events.push({
      time,
      minutes: hour * 60 + minute,
      title,
      description,
      sourceUrl: titleLink?.[1]
        ? absoluteUrl(titleLink[1])
        : GUIDE_URL
    });
  }

  return events;
}

function assignDates(events, dates) {
  if (!events.length || !dates.length) return [];

  let dayIndex = 0;
  let previousMinutes = null;

  return events.map(event => {
    /*
     * La parrilla diaria de CMM comienza a las 06:00.
     * El salto 22:45 → 00:15 sigue siendo el mismo día televisivo.
     * El nuevo día empieza cuando la madrugada salta otra vez a 06:00 o más.
     */
    if (
      previousMinutes !== null &&
      previousMinutes < 6 * 60 &&
      event.minutes >= 6 * 60 &&
      dayIndex < dates.length - 1
    ) {
      dayIndex++;
    }

    previousMinutes = event.minutes;

    return {
      ...event,
      date: dates[dayIndex] || null
    };
  });
}

// The current broadcaster guide labels each civil-day panel explicitly.
function getAttrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([^\s=<>]+)\s*=\s*["']([^"']*)["']/g)]
    .map(([, key, value]) => [key.toLowerCase(), decodeHtml(value)]));
}
const hasClass = (attrs, name) => String(attrs.class || "").split(/\s+/).includes(name);
function madridToday(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(+fields.year, +fields.month - 1, +fields.day));
}
function readModernGuide(html, now) {
  const tabs = [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/gi)]
    .map(([, tag, label]) => ({ attrs: getAttrs(tag), label: normalizeWeekday(stripHtml(label)) }))
    .filter(({ attrs }) => hasClass(attrs, "js-date-tab"));
  if (!tabs.length || tabs.length > 15) throw new Error("Pestañas CMM ausentes o fuera de alcance.");
  const today = madridToday(now);
  let explicitDates = 0;
  const dates = tabs.map(({ attrs, label }, index) => {
    if (attrs.role !== "tab" || attrs["data-date-target"] !== "schedule-day-" + index ||
        attrs["aria-controls"] !== attrs["data-date-target"] || attrs.id !== "date-tab-" + index)
      throw new Error("Vínculo pestaña/día CMM no verificable.");
    const day = addUtcDays(today, index);
    const named = label.match(/^(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(\d{1,2})$/);
    if (named && weekdayNumber(named[1]) === day.getUTCDay() && Number(named[2]) === day.getUTCDate())
      explicitDates++;
    else if (!(index === 0 && label === "hoy") && !(index === 1 && label === "manana"))
      throw new Error("Fecha de pestaña CMM no concuerda con la fecha local.");
    return isoDate(day);
  });
  if (!explicitDates) throw new Error("CMM no aporta día explícito para verificar la fecha.");
  const divTags = [...html.matchAll(/<\/?div\b[^>]*>/gi)];
  const panels = new Map();
  for (let i = 0; i < divTags.length; i++) {
    const node = divTags[i], tag = node[0];
    if (tag.startsWith("</")) continue;
    const attrs = getAttrs(tag);
    if (!hasClass(attrs, "schedule-day")) continue;
    const j = Number((attrs.id || "").match(/^schedule-day-(\d+)$/)?.[1] ?? NaN);
    if (!Number.isInteger(j) || j >= dates.length || panels.has(j) || attrs.role !== "tabpanel" ||
        attrs["aria-labelledby"] !== "date-tab-" + j) throw new Error("Panel de día CMM no verificable.");
    let depth = 1, end = i + 1;
    for (; end < divTags.length && depth; end++) depth += divTags[end][0].startsWith("</") ? -1 : 1;
    if (depth) throw new Error("Panel CMM incompleto.");
    panels.set(j, html.slice(node.index + tag.length, divTags[end - 1].index));
  }
  if (panels.size !== dates.length) throw new Error("Faltan paneles en la guía CMM.");
  const events = [];
  for (const [index, panel] of [...panels].sort(([a], [b]) => a - b)) {
    let slots = 0;
    for (const [, tag, fragment] of panel.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = getAttrs(tag);
      if (!hasClass(attrs, "schedule-item")) continue;
      const time = stripHtml(extractClassContent(fragment, "time", "div"));
      const title = stripHtml(fragment.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !title)
        throw new Error("Emisión CMM con título u hora inválidos.");
      slots++;
      const description = stripHtml(fragment.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
      events.push({ date: dates[index], time, title, description,
        sourceUrl: attrs.href ? absoluteUrl(attrs.href) : GUIDE_URL });
    }
    if (!slots) throw new Error("Panel CMM sin emisiones verificables.");
  }
  return { dates, events };
}

export function parseGuideHtml(html, now = new Date()) {
  if (/js-date-tab|guide-schedule-wrapper/.test(html)) return readModernGuide(html, now);
  if (!/c-event__hour/.test(html)) throw new Error("La respuesta no contiene una guía de emisiones verificable.");
  const dates = resolveHeaderDates(extractDateHeaders(html), now);
  const events = assignDates(extractEvents(html), dates);
  if (!dates.length || !events.length) throw new Error("No se pudo reconstruir la parrilla CMM.");
  return {dates, events};
}

const MONTHS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO",
  "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

// Fecha de un festejo citado en la descripción: «La corrida del 23 de agosto de 2026».
function describedFestejoDate(text = "") {
  const match = text.match(/\b(\d{1,2}) DE (ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SE(?:P)?TIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)(?: DE (20\d{2}))?\b/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].replace("SETIEMBRE", "SEPTIEMBRE")) + 1;
  if (!month || !match[3]) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

export function classifyBroadcast(title = "", description = "", broadcastDate = "") {
  const text = `${title} ${description}`
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const titleText = normalizeSpace(title)
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  /*
   * Programa taurino semanal de CMM.
   * Debe aparecer igual que Toros para Todos, Tendido Cero o Grana y Oro.
   */
  if (/^(?:TOREROS, HISTORIA Y ARTE|NUESTRO CAMPO BRAVO)(?: \(20\d{2}\))?$/.test(titleText)) return "Programa taurino";

  if (text.includes("TIEMPO DE TOROS")) {
    return "Programa taurino";
  }

  /*
   * Resúmenes, reposiciones y documentales («TOROS: LO MEJOR DE LA TEMPORADA»)
   * son programas aunque el título empiece por TOROS.
   */
  // Solo con contexto taurino en el título: «LO MEJOR DEL OESTE» es cine y
  // «LO MEJOR DE ANCHA ES CASTILLA LA MANCHA», un programa regional.
  const taurineTitle = /^TOROS\b|\bTAURIN|\bCORRIDAS?\b|\bNOVILLADAS?\b|\bREJONE/.test(titleText);
  if (taurineTitle && /\b(?:LO MEJOR|RESUMEN(?:ES)?|REPOSICION(?:ES)?|DOCUMENTAL|MAGAZINE|TERTULIA)\b/.test(titleText)) {
    return "Programa taurino";
  }

  /*
   * Una corrida grabada que se emite días después («Corrida del 20 de agosto
   * de 2026» emitida en octubre) es una reposición, no un festejo de ese día.
   * Sin una fecha anterior explícita se mantiene como retransmisión.
   */
  const festejoDate = describedFestejoDate(text);
  if (festejoDate && /^\d{4}-\d{2}-\d{2}$/.test(broadcastDate) && festejoDate < broadcastDate) {
    return "Programa taurino";
  }

  /*
   * Retransmisiones de festejos.
   */
  if (
    /^TOROS(?:\s|$)/.test(text) ||
    /\bCORRIDA(?: DE TOROS| DE REJONES)?\b/.test(text) ||
    /\bNOVILLADA\b/.test(text) ||
    /\bREJONES?\b/.test(text) ||
    /\bRECORTES?\b/.test(text)
  ) {
    return inferType(title, description);
  }

  return null;
}

function inferType(title = "", description = "") {
  const text = `${title} ${description}`;
  const genericTitle = normalizeSpace(title)
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  // «TOROS 2026» es el nombre de la franja de CMM, no el tipo del festejo.
  // Su descripción enumera corridas, rejones y novilladas en general, por lo
  // que no debe clasificarse como rejones por encontrar esa palabra primero.
  if (/^TOROS(?:\s+20\d{2})?$/.test(genericTitle)) {
    return "Festejo taurino";
  }

  if (/\brejones?\b|\brejoneo\b/i.test(text)) {
    return "Corrida de rejones";
  }

  if (/\bnovillada\b/i.test(text)) {
    return /\bpicadores\b/i.test(text)
      ? "Novillada con picadores"
      : "Novillada";
  }

  if (/\brecortes?\b/i.test(text)) {
    return "Concurso de recortes";
  }

  return "Corrida de toros";
}

function deduplicate(events) {
  const map = new Map();

  for (const event of events) {
    const key = [
      event.date,
      event.time,
      event.title.toLowerCase()
    ].join("|");

    if (!map.has(key)) map.set(key, event);
  }

  return [...map.values()].sort((a, b) =>
    `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)
  );
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "es-ES,es;q=0.9"
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  const html = await response.text();
  if (!/c-event__hour|js-date-tab|guide-schedule-wrapper/.test(html)) {
    throw new Error(`La respuesta no contiene una guía de emisiones verificable (destino: ${response.url}). No se interpreta como parrilla vacía.`);
  }
  return html;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const errors = [];

  let html = "";
  let dates = [];
  let allEvents = [];

  try {
    html = await fetchHtml(GUIDE_URL);
    ({ dates, events: allEvents } = parseGuideHtml(html, new Date(generatedAt)));
  } catch (error) {
    errors.push({
      url: GUIDE_URL,
      error: error.message
    });
  }

  const broadcasts = allEvents
    .map(event => {
      if (!event.date) return null;

      const type = classifyBroadcast(
        event.title,
        event.description,
        event.date
      );

      if (!type) return null;

      return {
        source: SOURCE,
        title:
          event.title.toUpperCase() === "TOROS"
            ? "Toros en CMM"
            : event.title,
        type,
        date: event.date,
        time: event.time,
        channel: "CMM",
        location: "",
        breeding: "",
        participants: [],
        description: event.description,
        sourceUrl: event.sourceUrl
      };
    })
    .filter(Boolean);

  const events = deduplicate(broadcasts).map((event, index) => ({
    id: `cmm-${event.date}-${event.time.replace(":", "")}-${index + 1}`,
    ...event
  }));

  if (html && !dates.length) {
    errors.push({
      url: GUIDE_URL,
      error: "No se pudo reconstruir la secuencia de fechas de la parrilla."
    });
  }

  const current = {
    source: SOURCE,
    generatedAt,
    sourceUrl: GUIDE_URL,
    status: errors.length ? "partial" : "ok",
    eventCount: events.length,
    checkedPages: html ? 1 : 0,
    discoveredDates: dates,
    detectedScheduleItems: allEvents.length,
    errorCount: errors.length,
    errors,
    events
  };

  let previous = null;
  try { previous = JSON.parse(await fs.readFile(OUTPUT, 'utf8')); } catch {}
  const output = preserveGuideOnFailure(current, previous);

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(
    OUTPUT,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`CMM: ${events.length} festejos encontrados.`);
  console.log(`Fechas detectadas: ${dates.length}.`);
  console.log(`Emisiones leídas: ${allEvents.length}.`);
  console.log(`Archivo guardado en ${OUTPUT}.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch(error => {
  console.error(error);
  process.exit(1);
});
