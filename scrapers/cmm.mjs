import fs from "node:fs/promises";
import path from "node:path";

const SOURCE = "CMM";
const GUIDE_URL = "https://www.cmmedia.es/play/programacion/tv";
const OUTPUT = path.resolve("data/cmm.json");

const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)";

const TAURINE_PATTERNS = [
  /\btoros?\b/i,
  /\bcorrida\b/i,
  /\bnovillad[ao]\b/i,
  /\brejones?\b/i,
  /\brejoneo\b/i,
  /\btauromaquia\b/i,
  /\btaurin[oa]s?\b/i,
  /\bpromesas de nuestra tierra\b/i,
  /\bnuestro campo bravo\b/i,
  /\btiempo de toros\b/i,
  /\bplaytoros\b/i,
  /\brecortes?\b/i,
  /\bganader[ií]as?\b/i,
  /\btoreo\b/i,
  /\btorero\b/i
];

const EXCLUDED_PATTERNS = [
  /\bnoticias?\b/i,
  /\binformativo\b/i,
  /\bcastilla[\s-]+la mancha (?:a las|hoy|despierta)\b/i
];

function normalizeSpace(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value = "") {
  const named = {
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
    .replace(/&#(\d+);/g, (_, number) =>
      String.fromCodePoint(Number(number))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      String.fromCodePoint(parseInt(number, 16))
    )
    .replace(/&([a-zA-Z]+);/g, (whole, name) =>
      Object.hasOwn(named, name) ? named[name] : whole
    );
}

function stripHtml(html = "") {
  return normalizeSpace(
    decodeHtml(
      String(html)
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|article|section|li|h[1-6]|time|a)>/gi, "\n")
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

function dateToIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function monthNumber(name = "") {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const months = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
  };

  return months[normalized] || null;
}

function resolveYear(month, day, reference = new Date()) {
  const candidates = [
    reference.getUTCFullYear() - 1,
    reference.getUTCFullYear(),
    reference.getUTCFullYear() + 1
  ];

  let best = candidates[0];
  let bestDistance = Infinity;

  for (const year of candidates) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    const distance = Math.abs(candidate - reference);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = year;
    }
  }

  return best;
}

function extractGuideDates(html) {
  const results = [];
  const seen = new Set();

  const attributePatterns = [
    /\bdata-(?:date|day|fecha)\s*=\s*["'](\d{4})-(\d{2})-(\d{2})["']/gi,
    /\b(?:date|fecha)\s*=\s*["'](\d{4})-(\d{2})-(\d{2})["']/gi
  ];

  for (const pattern of attributePatterns) {
    for (const match of html.matchAll(pattern)) {
      const iso = dateToIso(+match[1], +match[2], +match[3]);
      if (iso && !seen.has(iso)) {
        seen.add(iso);
        results.push(iso);
      }
    }
  }

  const text = stripHtml(html);
  const fullDatePattern =
    /\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)?\s*(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/gi;

  for (const match of text.matchAll(fullDatePattern)) {
    const day = +match[1];
    const month = monthNumber(match[2]);
    const year = match[3]
      ? +match[3]
      : resolveYear(month, day, new Date());

    const iso = dateToIso(year, month, day);
    if (iso && !seen.has(iso)) {
      seen.add(iso);
      results.push(iso);
    }
  }

  /*
   * La cabecera visual de la guía muestra una sucesión:
   * "lunes 20 martes 21 ... domingo 02".
   * Si el HTML no expone fechas completas, reconstruimos esa secuencia
   * tomando como referencia la fecha actual.
   */
  if (results.length === 0) {
    const headerMatches = [
      ...text.matchAll(
        /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})\b/gi
      )
    ].slice(0, 20);

    if (headerMatches.length) {
      const now = new Date();
      const weekdays = {
        domingo: 0,
        lunes: 1,
        martes: 2,
        miercoles: 3,
        miércoles: 3,
        jueves: 4,
        viernes: 5,
        sabado: 6,
        sábado: 6
      };

      let cursor = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - 10
      ));

      for (const match of headerMatches) {
        const weekdayName = match[1].toLowerCase();
        const targetWeekday = weekdays[weekdayName];
        const targetDay = +match[2];
        let found = null;

        for (let offset = 0; offset < 40; offset++) {
          const candidate = new Date(cursor);
          candidate.setUTCDate(candidate.getUTCDate() + offset);

          if (
            candidate.getUTCDate() === targetDay &&
            candidate.getUTCDay() === targetWeekday
          ) {
            found = candidate;
            break;
          }
        }

        if (found) {
          const iso = found.toISOString().slice(0, 10);
          if (!seen.has(iso)) {
            seen.add(iso);
            results.push(iso);
          }
          cursor = new Date(found);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
    }
  }

  return results.sort();
}

function extractLinks(fragment) {
  const links = [];

  for (const match of String(fragment).matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    links.push({
      url: absoluteUrl(match[1]),
      text: stripHtml(match[2])
    });
  }

  return links;
}

function isTaurine(title, description = "") {
  const text = `${title} ${description}`;
  if (!TAURINE_PATTERNS.some(pattern => pattern.test(text))) return false;

  if (
    EXCLUDED_PATTERNS.some(pattern => pattern.test(title)) &&
    !/\btoros?\b|\btauromaquia\b|\btaurin[oa]\b/i.test(title)
  ) {
    return false;
  }

  return true;
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

  if (/\bcorrida\b|\btoros?\b/i.test(text)) {
    return "Corrida de toros";
  }

  return "Programa taurino";
}

function cleanTitle(title = "") {
  return normalizeSpace(title)
    .replace(/\s+\|\s+CMM(?:Play)?$/i, "")
    .replace(/\s+-\s+CMM(?:Play)?$/i, "")
    .replace(/\s+\d+$/g, "")
    .trim();
}

function inferLocation(title = "", description = "") {
  const text = `${title}. ${description}`;

  const patterns = [
    /\b(?:desde|en|de)\s+(?:la plaza de toros de\s+)?([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,45})(?=[,.;]|$)/,
    /\b(?:toros|novillada|rejones|recortes)\s+(?:en|de)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,45})(?=[,.;]|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const candidate = normalizeSpace(match[1])
        .replace(/\b(?:este|esta|el|la|los|las)\b.*$/i, "")
        .trim();

      if (candidate.length >= 3 && candidate.length <= 50) {
        return candidate;
      }
    }
  }

  return "Castilla-La Mancha";
}

function parseScheduleItems(html, dates) {
  /*
   * Estrategia principal: convertimos el HTML en bloques delimitados por
   * cada hora de emisión. Esto evita depender de las clases CSS internas.
   */
  const timeMatches = [
    ...html.matchAll(
      /(?:^|>|\s)([01]?\d|2[0-3]):([0-5]\d)(?=<|\s|$)/g
    )
  ];

  const blocks = [];

  for (let index = 0; index < timeMatches.length; index++) {
    const match = timeMatches[index];
    const start = match.index;
    const end =
      index + 1 < timeMatches.length
        ? timeMatches[index + 1].index
        : html.length;

    const fragment = html.slice(start, end);
    const time = `${String(+match[1]).padStart(2, "0")}:${match[2]}`;
    const links = extractLinks(fragment);

    let title = "";
    let sourceUrl = GUIDE_URL;

    const headingMatch = fragment.match(
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i
    );

    if (headingMatch) {
      title = stripHtml(headingMatch[1]);
      const headingLinks = extractLinks(headingMatch[1]);
      sourceUrl = headingLinks[0]?.url || sourceUrl;
    }

    if (!title) {
      const usefulLink = links.find(link =>
        link.text &&
        !/^(play|ver|directo|más información)$/i.test(link.text)
      );

      title = usefulLink?.text || "";
      sourceUrl = usefulLink?.url || sourceUrl;
    }

    const plain = stripHtml(fragment);
    let description = plain
      .replace(new RegExp(`^${time.replace(":", "\\:")}\\s*`), "")
      .replace(title, "")
      .replace(/\bPlay\b/gi, "")
      .trim();

    title = cleanTitle(title);

    if (!title || title.length > 180) continue;
    if (!isTaurine(title, description)) continue;

    blocks.push({
      time,
      title,
      description: normalizeSpace(description).slice(0, 700),
      sourceUrl
    });
  }

  /*
   * La guía concatena los días. Detectamos el comienzo de cada parrilla:
   * normalmente 06:00 y, si cambia el horario, cualquier salto claro desde
   * la madrugada hacia una hora posterior.
   */
  let dayIndex = 0;
  let previousMinutes = null;
  let itemsInCurrentDay = 0;

  for (const block of blocks) {
    const [hour, minute] = block.time.split(":").map(Number);
    const currentMinutes = hour * 60 + minute;

    const startsNewDay =
      previousMinutes !== null &&
      itemsInCurrentDay > 0 &&
      (
        (previousMinutes <= 5 * 60 + 59 && currentMinutes >= 6 * 60) ||
        (currentMinutes - previousMinutes >= 5 * 60)
      );

    if (startsNewDay && dayIndex < dates.length - 1) {
      dayIndex++;
      itemsInCurrentDay = 0;
    }

    block.date = dates[dayIndex] || dates[0] || null;
    previousMinutes = currentMinutes;
    itemsInCurrentDay++;
  }

  return blocks.filter(block => block.date);
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
  let dates = [];
  let parsedItems = [];

  try {
    html = await fetchHtml(GUIDE_URL);
    dates = extractGuideDates(html);
    parsedItems = parseScheduleItems(html, dates);
  } catch (error) {
    errors.push({
      url: GUIDE_URL,
      error: error.message
    });
  }

  const events = deduplicate(
    parsedItems.map((item, index) => ({
      id: `cmm-${item.date}-${item.time.replace(":", "")}-${index + 1}`,
      source: SOURCE,
      title: item.title,
      type: inferType(item.title, item.description),
      date: item.date,
      time: item.time,
      channel: "CMM",
      location: inferLocation(item.title, item.description),
      breeding: "",
      participants: [],
      description: item.description,
      sourceUrl: item.sourceUrl || GUIDE_URL
    }))
  );

  const output = {
    source: SOURCE,
    generatedAt,
    sourceUrl: GUIDE_URL,
    status: errors.length ? "partial" : "ok",
    eventCount: events.length,
    checkedPages: html ? 1 : 0,
    discoveredDates: dates,
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

  console.log(`CMM: ${events.length} emisiones taurinas encontradas.`);
  console.log(`Fechas detectadas: ${dates.length}.`);
  console.log(`Archivo guardado en ${OUTPUT}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
