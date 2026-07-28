
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE = "CMM";
const GUIDE_URL = "https://www.cmmedia.es/play/programacion/tv";
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

function resolveHeaderDates(headers) {
  if (!headers.length) return [];

  const now = new Date();
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

function isBullfightingBroadcast(title = "") {
  const text = title.toUpperCase();

  /*
   * No metemos aquí documentales ni programas semanales:
   * esos se gestionan con programas-taurinos.mjs.
   */
  return (
    text === "TOROS" ||
    /\bCORRIDA(?: DE TOROS| DE REJONES)?\b/.test(text) ||
    /\bNOVILLADA\b/.test(text) ||
    /\bREJONES?\b/.test(text) ||
    /\bRECORTES?\b/.test(text)
  );
}

function inferType(title = "", description = "") {
  const text = `${title} ${description}`;

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

  return response.text();
}

async function main() {
  const generatedAt = new Date().toISOString();
  const errors = [];

  let html = "";
  let headers = [];
  let dates = [];
  let allEvents = [];

  try {
    html = await fetchHtml(GUIDE_URL);
    headers = extractDateHeaders(html);
    dates = resolveHeaderDates(headers);
    allEvents = assignDates(extractEvents(html), dates);
  } catch (error) {
    errors.push({
      url: GUIDE_URL,
      error: error.message
    });
  }

  const broadcasts = allEvents
    .filter(event =>
      event.date &&
      isBullfightingBroadcast(event.title)
    )
    .map((event, index) => ({
      id: `cmm-${event.date}-${event.time.replace(":", "")}-${index + 1}`,
      source: SOURCE,
      title:
        event.title.toUpperCase() === "TOROS"
          ? "Toros en CMM"
          : event.title,
      type: inferType(event.title, event.description),
      date: event.date,
      time: event.time,
      channel: "CMM",
      location: "",
      breeding: "",
      participants: [],
      description: event.description,
      sourceUrl: event.sourceUrl
    }));

  const events = deduplicate(broadcasts);

  if (html && !dates.length) {
    errors.push({
      url: GUIDE_URL,
      error: "No se pudo reconstruir la secuencia de fechas de la parrilla."
    });
  }

  const output = {
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
