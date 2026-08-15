
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = "data";
const OUTPUT_FILE = path.join(DATA_DIR, "programacion.json");
const HISTORY_FILE = path.join(DATA_DIR, "historico.json");

const SOURCE_FILES = {
  elMuletazo: path.join(DATA_DIR, "elmuletazo.json"),
  oneToro: path.join(DATA_DIR, "onetoro.json"),
  programasTaurinos: path.join(DATA_DIR, "programas-taurinos.json"),
  canalSur: path.join(DATA_DIR, "canalsur.json"),
  cmm: path.join(DATA_DIR, "cmm.json"),
  canalExtremadura: path.join(DATA_DIR, "canalextremadura.json"),
  mundoToro: path.join(DATA_DIR, "mundotoro.json"),
  lasVentas: path.join(DATA_DIR, "lasventas.json"),
  vaDeToros: path.join(DATA_DIR, "vadetoros.json"),
  aplausos: path.join(DATA_DIR, "aplausos.json")
};

const SOURCE_LABELS = {
  elMuletazo: "El Muletazo",
  oneToro: "OneToro",
  programasTaurinos: "Programas taurinos",
  canalSur: "Canal Sur",
  cmm: "CMM",
  canalExtremadura: "Canal Extremadura",
  mundoToro: "Mundotoro",
  lasVentas: "Las Ventas oficial",
  vaDeToros: "Va de Toros",
  aplausos: "Aplausos"
};

const SOURCE_CONFIDENCE = {
  "Canal Sur": 98,
  "Canal Extremadura": 98,
  OneToro: 96,
  "El Muletazo": 90,
  "Programas taurinos": 88,
  Mundotoro: 86,
  "Las Ventas oficial": 100,
  "Va de Toros": 95,
  Aplausos: 96,
  Telemadrid: 98,
  CMM: 98,
  RTVE: 98,
  "La 7 CyL": 98,
  "Toros en España Play": 94
};

/*
 * Emisiones especiales confirmadas públicamente que OneToro anuncia
 * fuera de su contenedor habitual de próximos festejos. Se mantienen
 * aquí para que no desaparezcan en cada actualización automática.
 */
const CONFIRMED_SPECIAL_PROGRAMS = [
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16"
].map(date => ({
  id: `onetoro-conexion-dax-${date}`,
  date,
  time: "20:00",
  channel: "OneToro",
  televised: true,
  location: "Dax (Landes) Francia",
  name: "Conexión Dax",
  title: "Conexión Dax",
  type: "Programa taurino",
  contentType: "programa",
  source: "OneToro",
  sourceUrl:
    "https://festejos.onetoro.tv/content/ultimos-dos-festejos"
}));

function normalizeText(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[«»“”"'´`]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(name = "") {
  return String(name)
    .replace(/\s*\(\d{2}\/\d{2}\/\d{4}\)\s*$/, "")
    .replace(/^ganader[ií]a\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBreeding(value = "") {
  let cleaned = String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&iacute;|&#237;|&#x0*ed;/gi, "í")
    .replace(/&Iacute;|&#205;|&#x0*cd;/gi, "Í")
    .replace(/&(?:laquo|raquo|ldquo|rdquo|quot);/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[«»“”"'´`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const prefixPattern =
    /^\s*ganader(?:í|i)a\s*(?::|\-|–|—)?\s*/i;

  let previousValue = null;

  while (
    cleaned &&
    cleaned !== previousValue &&
    prefixPattern.test(cleaned)
  ) {
    previousValue = cleaned;

    cleaned = cleaned
      .replace(prefixPattern, "")
      .replace(/^[\s:–—-]+/, "")
      .trim();
  }

  cleaned = cleanName(cleaned);

  if (
    !cleaned ||
    /^(?:ganader(?:í|i)a\s*)+$/i.test(cleaned) ||
    cleaned.length > 220 ||
    /servicio gratis|me gusta responder|comentarios?|pulsa aqu[ií]/i.test(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

function cleanParticipants(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .map(value => cleanName(value))
      .filter(Boolean)
  )];
}

function normalizeChannel(channel = "") {
  const value = normalizeText(channel);

  const aliases = [
    [/^onetoro$|^one toro$/, "OneToro"],
    [/canal sur/, "Canal Sur"],
    [/canal extremadura|extremadura tv|extremadura television/, "Canal Extremadura"],
    [/telemadrid/, "Telemadrid"],
    [/castilla la mancha|cmmedia|^cmm$/, "CMM"],
    [/castilla y leon|la 7 cyl|^cyltv$/, "La 7 CyL"],
    [/rtve|la 2|tendido cero/, "RTVE"],
    [/toros en espana play/, "Toros en España Play"]
  ];

  for (const [pattern, canonical] of aliases) {
    if (pattern.test(value)) return canonical;
  }

  return cleanName(channel) || "Televisión";
}

function isNonTelevisedChannel(channel = "") {
  const value = normalizeText(channel);

  return (
    !value ||
    value === "sin tv" ||
    value === "no televisado" ||
    value === "no televisada" ||
    value === "sin television"
  );
}

function isDeferredBroadcast(event = {}) {
  if (event.deferred === true) return true;

  return /\b(?:en\s+)?diferido\b/i.test(
    [
      event.broadcastMode,
      event.emissionType,
      event.sourceText,
      event.title,
      event.name,
      event.type,
      event.channel
    ]
      .filter(Boolean)
      .join(" ")
  );
}


function normalizeType(type = "") {
  const value = normalizeText(type);

  if (!value) return "Festejo taurino";
  if (value.includes("programa")) return "Programa taurino";
  if (value.includes("mixta") || value.includes("mixto")) return "Festejo mixto";
  if (value.includes("rejones") || value.includes("rejoneo")) return "Rejones";
  if (
    value.includes("novillada") &&
    (value.includes("sin picadores") || value.includes("sin caballos"))
  ) {
    return "Novillada sin picadores";
  }
  if (value.includes("novillada") && value.includes("picadores")) {
    return "Novillada con picadores";
  }
  if (value.includes("novillada")) return "Novillada";
  if (value.includes("corrida")) return "Corrida de toros";
  if (value.includes("recortadores") || value.includes("recortes")) {
    return "Concurso de recortadores";
  }

  return cleanName(type);
}

function words(text = "") {
  return normalizeText(text)
    .split(" ")
    .filter(word => word.length > 1);
}

function similarity(a = "", b = "") {
  const aWords = new Set(words(a));
  const bWords = new Set(words(b));

  if (!aWords.size || !bWords.size) return 0;

  let matches = 0;
  for (const word of aWords) {
    if (bWords.has(word)) matches += 1;
  }

  return matches / Math.max(aWords.size, bWords.size);
}

function levenshteinDistance(first = "", second = "") {
  const a = normalizeText(first);
  const b = normalizeText(second);

  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;

      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function fuzzyTextSimilarity(first = "", second = "") {
  const a = normalizeText(first);
  const b = normalizeText(second);

  if (!a || !b) return 0;
  if (a === b) return 1;

  const wordScore = similarity(a, b);
  const distance = levenshteinDistance(a, b);
  const characterScore = 1 - distance / Math.max(a.length, b.length);

  return Math.max(wordScore, characterScore);
}

function normalizeLocationForMatch(value = "") {
  return normalizeText(
    String(value)
      .replace(/\([^)]*\)/g, " ")
      .replace(
        /\b(españa|spain|portugal|francia|france|méxico|mexico|colombia|perú|peru)\b/gi,
        " "
      )
  );
}

function locationSimilarity(first = "", second = "") {
  const a = normalizeLocationForMatch(first);
  const b = normalizeLocationForMatch(second);

  if (!a || !b) return 0;
  if (a === b) return 1;

  return fuzzyTextSimilarity(a, b);
}

function isGenericLabel(value = "") {
  const text = normalizeText(value);

  return (
    !text ||
    text === "television" ||
    text === "toros en cmm" ||
    text === "toros 2026" ||
    text === "festejo taurino" ||
    text === "cartel por confirmar" ||
    text === "programa taurino"
  );
}

function informationScore(event = {}) {
  let score = 0;

  if (event.time) score += 4;
  if (event.location && !isGenericLabel(event.location)) score += 8;
  if (event.name && !isGenericLabel(event.name)) score += 8;
  if (event.title && !isGenericLabel(event.title)) score += 5;
  if (event.type && normalizeType(event.type) !== "Festejo taurino") score += 3;
  if (event.breeding) score += 4;
  if (event.participants?.length) score += Math.min(8, event.participants.length * 2);
  if (event.eventUrl || event.sourceUrl) score += 1;

  return score;
}

function participantSimilarity(first = [], second = []) {
  const a = first.map(normalizeText).filter(Boolean);
  const b = second.map(normalizeText).filter(Boolean);

  if (!a.length || !b.length) return 0;

  let matches = 0;
  for (const firstName of a) {
    if (b.some(secondName => similarity(firstName, secondName) >= 0.6)) {
      matches += 1;
    }
  }

  return matches / Math.max(a.length, b.length);
}

function minutesFromTime(time) {
  if (!/^\d{1,2}:\d{2}$/.test(String(time || ""))) return null;
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function timeCloseness(first, second) {
  const a = minutesFromTime(first);
  const b = minutesFromTime(second);

  if (a === null || b === null) return 0;

  const difference = Math.abs(a - b);
  if (difference === 0) return 1;
  if (difference <= 30) return 0.8;
  if (difference <= 60) return 0.5;
  if (difference <= 90) return 0.25;
  return 0;
}

function canonicalLocation(value = "") {
  const original = normalizeText(value);

  if (original.includes("las ventas")) {
    return "madrid";
  }

  const text = normalizeText(String(value).replace(/\([^)]*\)/g, " "))
    .replace(/\bespana\b/g, " ")
    .replace(/\bplaza de toros\b/g, " ")
    .replace(/\bmonumental\b/g, " ")
    .replace(/\breal maestranza\b/g, " maestranza ")
    .replace(/[()[\],.;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases = [
    ["madrid", "madrid"],
    ["azpeitia", "azpeitia"],
    ["pamplona", "pamplona"],
    ["sevilla", "sevilla"],
    ["huelva", "huelva"],
    ["malaga", "malaga"],
    ["bilbao", "bilbao"],
    ["valencia", "valencia"],
    ["cordoba", "cordoba"],
    ["santander", "santander"],
    ["san sebastian", "san sebastian"],
    ["dax", "dax"],
    ["beziers", "beziers"],
    ["nimes", "nimes"],
    ["arles", "arles"],
    ["guipuzcoa", "azpeitia"],
    ["las ventas", "madrid"]
  ];

  for (const [needle, canonical] of aliases) {
    if (text.includes(needle)) {
      return canonical;
    }
  }

  return text;
}


function participantOverlap(first = [], second = []) {
  const firstSet = new Set(
    (first || [])
      .map(normalizeText)
      .filter(Boolean)
  );

  const secondSet = new Set(
    (second || [])
      .map(normalizeText)
      .filter(Boolean)
  );

  if (!firstSet.size || !secondSet.size) {
    return 0;
  }

  let matches = 0;

  for (const name of firstSet) {
    if (secondSet.has(name)) {
      matches += 1;
    }
  }

  return matches / Math.min(
    firstSet.size,
    secondSet.size
  );
}


function eventMatchScore(first, second) {
  if (!first?.date || first.date !== second?.date) return 0;
  if (first.contentType !== second.contentType) return 0;

  const channelA = normalizeChannel(first.channel);
  const channelB = normalizeChannel(second.channel);
  const sameChannel = channelA === channelB;

  const firstLabel = first.location || first.name;
  const secondLabel = second.location || second.name;
  const locationScore = locationSimilarity(firstLabel, secondLabel);

  const canonicalA = canonicalLocation(firstLabel);
  const canonicalB = canonicalLocation(secondLabel);

  const sameCanonicalLocation =
    canonicalA &&
    canonicalB &&
    canonicalA === canonicalB;

  const participantScore =
    participantOverlap(
      first.participants,
      second.participants
    );

  const breedingScore =
    fuzzyTextSimilarity(
      first.breeding,
      second.breeding
    );

  const exactTime =
    Boolean(first.time) &&
    Boolean(second.time) &&
    first.time === second.time;

  const oneTimeMissing =
    Boolean(first.time) !== Boolean(second.time);

  const firstGeneric =
    isGenericLabel(first.location) ||
    isGenericLabel(first.name) ||
    isGenericLabel(first.title);

  const secondGeneric =
    isGenericLabel(second.location) ||
    isGenericLabel(second.name) ||
    isGenericLabel(second.title);

  if (
    first.contentType === "festejo" &&
    sameCanonicalLocation &&
    participantScore >= 0.5
  ) {
    return 98;
  }

  if (
    first.contentType === "festejo" &&
    sameCanonicalLocation &&
    breedingScore >= 0.72
  ) {
    return 94;
  }

  if (
    first.contentType === "festejo" &&
    sameChannel &&
    exactTime &&
    (firstGeneric || secondGeneric)
  ) {
    return 96;
  }

  const closeTime =
    Boolean(first.time) &&
    Boolean(second.time) &&
    timeCloseness(first.time, second.time) >= 0.8;

  const firstHasDetails =
    Boolean(first.location && !isGenericLabel(first.location)) ||
    Boolean(first.participants?.length) ||
    Boolean(first.breeding);

  const secondHasDetails =
    Boolean(second.location && !isGenericLabel(second.location)) ||
    Boolean(second.participants?.length) ||
    Boolean(second.breeding);

  if (
    first.contentType === "festejo" &&
    sameChannel &&
    closeTime &&
    (
      (firstGeneric && secondHasDetails) ||
      (secondGeneric && firstHasDetails)
    )
  ) {
    return 94;
  }

  if (
    first.contentType === "festejo" &&
    sameChannel &&
    oneTimeMissing &&
    locationScore >= 0.72
  ) {
    return 88;
  }

  let score = 40;
  score += locationScore * 35;

  if (sameCanonicalLocation) score += 18;
  if (sameChannel) score += 8;

  score += timeCloseness(first.time, second.time) * 7;
  score += participantScore * 12;
  score += breedingScore * 5;

  return Math.round(score * 100) / 100;
}

function sourceConfidence(sourceName) {
  return SOURCE_CONFIDENCE[sourceName] || 80;
}

function calculateConfidence(event) {
  const sources = Array.isArray(event.sources) ? event.sources : [];
  const base = sources.reduce(
    (highest, source) => Math.max(highest, sourceConfidence(source)),
    0
  );

  let bonus = Math.max(0, sources.length - 1) * 2;
  if (event.date && event.location && event.channel) bonus += 1;
  if (event.time) bonus += 1;
  if (event.breeding) bonus += 1;
  if (event.participants?.length) bonus += 1;

  return Math.min(100, base + bonus);
}

function createSourceDetail(sourceName, sourceUrl = null, fetchedAt = null) {
  return {
    name: sourceName,
    confidence: sourceConfidence(sourceName),
    sourceUrl: sourceUrl || null,
    fetchedAt: fetchedAt || null
  };
}

function uniqueSourceDetails(details = []) {
  const result = new Map();

  for (const detail of details.filter(Boolean)) {
    const current = result.get(detail.name);
    if (!current || detail.confidence > current.confidence) {
      result.set(detail.name, detail);
    }
  }

  return [...result.values()];
}

function normalizeGenericEvent(event, sourceName, fetchedAt = null) {
  const contentType =
    event.contentType === "programa" ||
    normalizeType(event.type) === "Programa taurino"
      ? "programa"
      : "festejo";

  const normalized = {
    id: event.id || null,
    date: event.date || null,
    time: event.time || null,
    channel: normalizeChannel(event.channel || sourceName),
    deferred: isDeferredBroadcast(event),
    televised:
      event.televised === false
        ? false
        : !isNonTelevisedChannel(
            event.channel || sourceName
          ),
    televisionUnconfirmed:
      event.televised !== true &&
      event.televisionUnconfirmed === true,
    location: cleanName(event.location || event.name || "Televisión"),
    type:
      contentType === "programa"
        ? "Programa taurino"
        : normalizeType(event.type),
    contentType,
    breeding:
      contentType === "programa"
        ? ""
        : cleanBreeding(event.breeding),
    participants:
      contentType === "programa"
        ? []
        : cleanParticipants(event.participants),
    name: cleanName(
      event.name ||
      event.title ||
      event.location ||
      event.type ||
      "Festejo taurino"
    ),
    title: event.title ? cleanName(event.title) : null,
    image: event.image || null,
    eventUrl: event.eventUrl || event.sourceUrl || null,
    sourceUrl: event.sourceUrl || event.eventUrl || null,
    sources: [sourceName],
    sourceDetails: [
      createSourceDetail(
        sourceName,
        event.sourceUrl || event.eventUrl,
        fetchedAt
      )
    ]
  };

  normalized.confidence = calculateConfidence(normalized);
  normalized.status = normalized.confidence >= 94 ? "confirmed" : "probable";

  return normalized;
}

function normalizeOneToroEvent(event, fetchedAt = null) {
  if (
    event.contentType === "programa" ||
    normalizeType(event.type) === "Programa taurino"
  ) {
    return normalizeProgramEvent(event, "OneToro", fetchedAt);
  }

  return normalizeGenericEvent(
    {
      ...event,
      channel: "OneToro",
      location: cleanName(event.name),
      contentType: "festejo"
    },
    "OneToro",
    fetchedAt
  );
}

function normalizeMuletazoEvent(event, fetchedAt = null) {
  return normalizeGenericEvent(
    {
      ...event,
      contentType: event.contentType || "festejo"
    },
    "El Muletazo",
    fetchedAt
  );
}

function normalizeMundoToroEvent(event, fetchedAt = null) {
  return normalizeGenericEvent(
    {
      ...event,
      channel: "Sin TV",
      televised: false,
      contentType: "festejo"
    },
    "Mundotoro",
    fetchedAt
  );
}


function normalizeProgramEvent(
  event,
  fallbackSource = "Programas taurinos",
  fetchedAt = null
) {
  const sourceName = event.source || event.channel || fallbackSource;

  return normalizeGenericEvent(
    {
      ...event,
      channel: event.channel || sourceName,
      location: event.location || "Televisión",
      type: "Programa taurino",
      contentType: "programa",
      name: event.title || event.name || "Programa taurino",
      title: event.title || event.name || "Programa taurino",
      breeding: "",
      participants: []
    },
    sourceName,
    fetchedAt
  );
}

function chooseValue(firstValue, secondValue, preferSecond = false) {
  const firstEmpty =
    firstValue === null ||
    firstValue === undefined ||
    firstValue === "";

  const secondEmpty =
    secondValue === null ||
    secondValue === undefined ||
    secondValue === "";

  if (firstEmpty && !secondEmpty) return secondValue;
  if (!firstEmpty && secondEmpty) return firstValue;
  if (firstEmpty && secondEmpty) return firstValue ?? secondValue ?? null;

  return preferSecond ? secondValue : firstValue;
}

function chooseInformativeValue(firstValue, secondValue, preferSecond = false) {
  const firstEmpty =
    firstValue === null ||
    firstValue === undefined ||
    firstValue === "";

  const secondEmpty =
    secondValue === null ||
    secondValue === undefined ||
    secondValue === "";

  if (firstEmpty && !secondEmpty) return secondValue;
  if (!firstEmpty && secondEmpty) return firstValue;
  if (firstEmpty && secondEmpty) return firstValue ?? secondValue ?? null;

  const firstGeneric = isGenericLabel(firstValue);
  const secondGeneric = isGenericLabel(secondValue);

  if (firstGeneric && !secondGeneric) return secondValue;
  if (!firstGeneric && secondGeneric) return firstValue;

  return preferSecond ? secondValue : firstValue;
}

function mergeParticipants(first = [], second = []) {
  const output = [...first];

  for (const candidate of second) {
    const exists = output.some(
      current => similarity(current, candidate) >= 0.75
    );

    if (!exists) output.push(candidate);
  }

  return output;
}

function mergeTwoEvents(first, second) {
  const firstIsLasVentasOfficial =
    first.sources?.includes("Las Ventas oficial");
  const secondIsLasVentasOfficial =
    second.sources?.includes("Las Ventas oficial");
  const officialLasVentasEvent = firstIsLasVentasOfficial
    ? first
    : (secondIsLasVentasOfficial ? second : null);
  const firstConfidence = sourceConfidence(first.sources?.[0]);
  const secondConfidence = sourceConfidence(second.sources?.[0]);

  const firstInformation = informationScore(first);
  const secondInformation = informationScore(second);

  const preferSecond =
    secondInformation > firstInformation ||
    (
      secondInformation === firstInformation &&
      secondConfidence > firstConfidence
    );

  const mergedChannel =
    isNonTelevisedChannel(first.channel) &&
    !isNonTelevisedChannel(second.channel)
      ? second.channel
      : (
          !isNonTelevisedChannel(first.channel) &&
          isNonTelevisedChannel(second.channel)
            ? first.channel
            : chooseValue(first.channel, second.channel, preferSecond)
        );

  const mergedIsTelevised = !isNonTelevisedChannel(mergedChannel);

  const merged = {
    ...first,
    id: chooseValue(first.id, second.id, preferSecond),
    date: chooseValue(first.date, second.date, preferSecond),
    time: chooseValue(first.time, second.time, preferSecond),
    channel: mergedChannel,
    deferred:
      first.deferred === true ||
      second.deferred === true,
    televised: mergedIsTelevised,
    televisionUnconfirmed:
      !mergedIsTelevised &&
      (
        first.televisionUnconfirmed === true ||
        second.televisionUnconfirmed === true
      ),
    location: chooseInformativeValue(
      first.location,
      second.location,
      preferSecond
    ),
    type: chooseInformativeValue(
      first.type,
      second.type,
      preferSecond
    ),
    contentType: first.contentType || second.contentType || "festejo",
    breeding: officialLasVentasEvent
      ? officialLasVentasEvent.breeding
      : chooseInformativeValue(
          first.breeding,
          second.breeding,
          preferSecond
        ),
    participants: officialLasVentasEvent
      ? [...officialLasVentasEvent.participants]
      : mergeParticipants(
          first.participants,
          second.participants
        ),
    name: chooseInformativeValue(
      first.name,
      second.name,
      preferSecond
    ),
    title: chooseInformativeValue(
      first.title,
      second.title,
      preferSecond
    ),
    image: chooseValue(first.image, second.image, preferSecond),
    eventUrl: chooseValue(first.eventUrl, second.eventUrl, preferSecond),
    sourceUrl: chooseValue(first.sourceUrl, second.sourceUrl, preferSecond),
    sources: [
      ...new Set([
        ...(first.sources || []),
        ...(second.sources || [])
      ])
    ],
    sourceDetails: uniqueSourceDetails([
      ...(first.sourceDetails || []),
      ...(second.sourceDetails || [])
    ])
  };

  merged.confidence = calculateConfidence(merged);
  merged.status = merged.confidence >= 94 ? "confirmed" : "probable";

  return merged;
}

function addOrMergeEvent(collection, candidate) {
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < collection.length; index += 1) {
    const score = eventMatchScore(collection[index], candidate);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  const threshold =
    candidate.contentType === "programa"
      ? 82
      : 70;

  if (bestIndex >= 0 && bestScore >= threshold) {
    collection[bestIndex] =
      mergeTwoEvents(
        collection[bestIndex],
        candidate
      );

    return {
      merged: true,
      score: bestScore
    };
  }

  collection.push(candidate);

  return {
    merged: false,
    score: bestScore
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readOptionalJson(filePath, fallback = null) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`No se pudo leer ${filePath}: ${error.message}`);
    }

    return fallback;
  }
}

async function readSource(key, defaultValue = { events: [] }) {
  const filePath = SOURCE_FILES[key];

  try {
    const data = await readJson(filePath);
    const events = Array.isArray(data.events) ? data.events : [];

    return {
      key,
      label: SOURCE_LABELS[key],
      filePath,
      ok: true,
      eventCount: events.length,
      fetchedAt: data.fetchedAt || data.updatedAt || null,
      data,
      error: null
    };
  } catch (error) {
    console.warn(`Fuente no disponible: ${filePath} (${error.message})`);

    return {
      key,
      label: SOURCE_LABELS[key],
      filePath,
      ok: false,
      eventCount: 0,
      fetchedAt: null,
      data: defaultValue,
      error: error.message
    };
  }
}

function validateEvent(event, index) {
  const errors = [];

  if (!event.date || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    errors.push(`Evento ${index + 1}: fecha inválida`);
  }

  if (!event.name && !event.title && !event.location) {
    errors.push(`Evento ${index + 1}: falta nombre, título o localidad`);
  }

  if (!event.channel) {
    errors.push(`Evento ${index + 1}: falta canal`);
  }

  if (!Array.isArray(event.sources) || event.sources.length === 0) {
    errors.push(`Evento ${index + 1}: faltan fuentes`);
  }

  return errors;
}

function validateOutput(output, previousOutput = null) {
  const errors = [];

  if (!Array.isArray(output.events)) {
    errors.push("La salida no contiene un array events");
    return errors;
  }

  if (output.events.length === 0) {
    errors.push("La programación resultante está vacía");
  }

  output.events.forEach((event, index) => {
    errors.push(...validateEvent(event, index));
  });

  if (
    previousOutput?.events?.length >= 10 &&
    output.events.length <
      Math.floor(previousOutput.events.length * 0.4)
  ) {
    errors.push(
      `Caída sospechosa de eventos: ${previousOutput.events.length} → ${output.events.length}`
    );
  }

  return errors;
}

function getDateKeyInTimeZone(
  date = new Date(),
  timeZone = "Europe/Madrid"
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function shouldPreserveHistoricalEvent(event, todayKey) {
  return (
    event &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || "")) &&
    String(event.date) < todayKey
  );
}

function normalizeStoredEvent(event = {}) {
  const contentType =
    event.contentType === "programa" ||
    normalizeType(event.type) === "Programa taurino"
      ? "programa"
      : "festejo";

  const storedSources =
    Array.isArray(event.sources) && event.sources.length
      ? [...new Set(event.sources.filter(Boolean))]
      : ["Histórico AlberoTV"];

  const storedDetails =
    Array.isArray(event.sourceDetails)
      ? uniqueSourceDetails(event.sourceDetails)
      : [];

  const normalized = {
    ...event,
    id: event.id || null,
    date: event.date || null,
    time: event.time || null,
    channel: normalizeChannel(event.channel),
    televised:
      event.televised === false
        ? false
        : !isNonTelevisedChannel(event.channel),
    televisionUnconfirmed:
      event.televised !== true &&
      event.televisionUnconfirmed === true,
    location: cleanName(
      event.location ||
      event.name ||
      (
        contentType === "programa"
          ? "Televisión"
          : "Localidad por confirmar"
      )
    ),
    type:
      contentType === "programa"
        ? "Programa taurino"
        : normalizeType(event.type),
    contentType,
    breeding:
      contentType === "programa"
        ? ""
        : cleanBreeding(event.breeding),
    participants:
      contentType === "programa"
        ? []
        : cleanParticipants(event.participants),
    name: cleanName(
      event.name ||
      event.title ||
      event.location ||
      event.type ||
      (
        contentType === "programa"
          ? "Programa taurino"
          : "Festejo taurino"
      )
    ),
    title: event.title ? cleanName(event.title) : null,
    image: event.image || null,
    eventUrl: event.eventUrl || event.sourceUrl || null,
    sourceUrl: event.sourceUrl || event.eventUrl || null,
    sources: storedSources,
    sourceDetails: storedDetails
  };

  normalized.confidence =
    Number.isFinite(Number(event.confidence))
      ? Number(event.confidence)
      : calculateConfidence(normalized);

  normalized.status =
    event.status ||
    (
      normalized.confidence >= 94
        ? "confirmed"
        : "probable"
    );

  return normalized;
}

function seedHistoricalEvents(collection, sources, todayKey) {
  let total = 0;
  let added = 0;
  let merged = 0;

  for (const source of sources) {
    const events =
      Array.isArray(source?.events)
        ? source.events
        : [];

    for (const event of events) {
      if (!shouldPreserveHistoricalEvent(event, todayKey)) {
        continue;
      }

      total += 1;

      const result = addOrMergeEvent(
        collection,
        normalizeStoredEvent(event)
      );

      if (result.merged) {
        merged += 1;
      } else {
        added += 1;
      }
    }
  }

  return {
    total,
    added,
    merged
  };
}

function sortEvents(events) {
  events.sort((a, b) => {
    const dateComparison =
      String(a.date || "").localeCompare(
        String(b.date || "")
      );

    if (dateComparison !== 0) return dateComparison;

    const timeComparison =
      String(a.time || "99:99").localeCompare(
        String(b.time || "99:99")
      );

    if (timeComparison !== 0) return timeComparison;

    return String(
      a.name ||
      a.title ||
      ""
    ).localeCompare(
      String(
        b.name ||
        b.title ||
        ""
      ),
      "es"
    );
  });

  return events;
}

async function main() {
  const previousOutput =
    await readOptionalJson(
      OUTPUT_FILE,
      { events: [] }
    );

  const previousHistory =
    await readOptionalJson(
      HISTORY_FILE,
      { events: [] }
    );

  const todayKey =
    getDateKeyInTimeZone(
      new Date(),
      "Europe/Madrid"
    );

  const [
    muletazo,
    oneToro,
    programas,
    canalSur,
    cmm,
    canalExtremadura,
    mundoToro,
    lasVentas,
    vaDeToros,
    aplausos
  ] = await Promise.all([
    readSource("elMuletazo"),
    readSource("oneToro"),
    readSource("programasTaurinos"),
    readSource("canalSur"),
    readSource("cmm"),
    readSource("canalExtremadura"),
    readSource("mundoToro"),
    readSource("lasVentas"),
    readSource("vaDeToros"),
    readSource("aplausos")
  ]);

  const sourceResults = [
    muletazo,
    oneToro,
    programas,
    canalSur,
    cmm,
    canalExtremadura,
    mundoToro,
    lasVentas,
    vaDeToros,
    aplausos
  ];

  if (!sourceResults.some(source => source.ok)) {
    throw new Error(
      "Todas las fuentes han fallado. Se conserva programacion.json."
    );
  }

  const merged = [];

  /*
   * El histórico permanente se alimenta de:
   * 1. data/historico.json
   * 2. la programación publicada anteriormente
   *
   * Así los eventos pasados no dependen de que las fuentes externas
   * sigan mostrándolos.
   */
  const historicalStats =
    seedHistoricalEvents(
      merged,
      [
        previousHistory,
        previousOutput
      ],
      todayKey
    );

  const mergeStats = {
    historicalCandidates: historicalStats.total,
    historicalPreserved: historicalStats.added,
    historicalDuplicatesMerged: historicalStats.merged,
    added: 0,
    merged: 0
  };

  for (const event of muletazo.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeMuletazoEvent(
        event,
        muletazo.fetchedAt
      )
    );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  for (const event of oneToro.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeOneToroEvent(
        event,
        oneToro.fetchedAt
      )
    );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  for (const event of canalSur.data.events || []) {
    const normalized =
      event.contentType === "programa"
        ? normalizeProgramEvent(
            event,
            "Canal Sur",
            canalSur.fetchedAt
          )
        : normalizeGenericEvent(
            event,
            "Canal Sur",
            canalSur.fetchedAt
          );

    const result =
      addOrMergeEvent(
        merged,
        normalized
      );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  for (const event of cmm.data.events || []) {
    const normalized =
      event.contentType === "programa"
        ? normalizeProgramEvent(
            event,
            "CMM",
            cmm.fetchedAt
          )
        : normalizeGenericEvent(
            event,
            "CMM",
            cmm.fetchedAt
          );

    const result =
      addOrMergeEvent(
        merged,
        normalized
      );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  for (const event of canalExtremadura.data.events || []) {
    const normalized =
      event.contentType === "programa" ||
      normalizeType(event.type) === "Programa taurino"
        ? normalizeProgramEvent(
            event,
            "Canal Extremadura",
            canalExtremadura.fetchedAt
          )
        : normalizeGenericEvent(
            event,
            "Canal Extremadura",
            canalExtremadura.fetchedAt
          );

    const result =
      addOrMergeEvent(
        merged,
        normalized
      );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  for (const event of mundoToro.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeMundoToroEvent(
        event,
        mundoToro.fetchedAt
      )
    );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  for (const event of lasVentas.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeGenericEvent(
        event,
        "Las Ventas oficial",
        lasVentas.fetchedAt
      )
    );

    mergeStats[result.merged ? "merged" : "added"] += 1;
  }

  for (const event of vaDeToros.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeGenericEvent(
        event,
        "Va de Toros",
        vaDeToros.fetchedAt
      )
    );

    mergeStats[result.merged ? "merged" : "added"] += 1;
  }

  for (const event of aplausos.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeGenericEvent(
        event,
        "Aplausos",
        aplausos.fetchedAt
      )
    );

    mergeStats[result.merged ? "merged" : "added"] += 1;
  }

  for (const event of programas.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeProgramEvent(
        event,
        "Programas taurinos",
        programas.fetchedAt
      )
    );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  for (const event of CONFIRMED_SPECIAL_PROGRAMS) {
    const result = addOrMergeEvent(
      merged,
      normalizeProgramEvent(
        event,
        "OneToro"
      )
    );

    mergeStats[
      result.merged
        ? "merged"
        : "added"
    ] += 1;
  }

  sortEvents(merged);

  const programCount =
    merged.filter(
      event =>
        event.contentType === "programa"
    ).length;

  const bullfightingEventCount =
    merged.length -
    programCount;

  const sourceHealth =
    Object.fromEntries(
      sourceResults.map(
        source => [
          source.key,
          {
            label: source.label,
            status:
              source.ok
                ? "ok"
                : "error",
            eventCount:
              source.eventCount,
            fetchedAt:
              source.fetchedAt,
            error:
              source.error
          }
        ]
      )
    );

  const output = {
    generatedAt:
      new Date().toISOString(),

    degraded:
      sourceResults.some(
        source =>
          !source.ok
      ),

    eventCount:
      merged.length,

    bullfightingEventCount,

    programCount,

    mergeStats,

    sources: {
      elMuletazo:
        muletazo.eventCount,

      oneToro:
        oneToro.eventCount,

      programasTaurinos:
        programas.eventCount,

      canalSur:
        canalSur.eventCount,

      cmm:
        cmm.eventCount,

      canalExtremadura:
        canalExtremadura.eventCount,

      mundoToro:
        mundoToro.eventCount,

      lasVentas:
        lasVentas.eventCount,

      vaDeToros:
        vaDeToros.eventCount,

      aplausos:
        aplausos.eventCount
    },

    sourceHealth,

    events:
      merged
  };

  const validationErrors =
    validateOutput(
      output,
      previousOutput
    );

  if (validationErrors.length > 0) {
    console.error(
      "No se publica la nueva programación por errores de validación:"
    );

    for (
      const error
      of validationErrors.slice(0, 20)
    ) {
      console.error(
        `- ${error}`
      );
    }

    process.exitCode = 1;
    return;
  }

  /*
   * El archivo histórico solo contiene fechas anteriores a hoy.
   * Se regenera en cada ejecución y queda guardado en Git.
   */
  const historicalEvents =
    merged.filter(
      event =>
        shouldPreserveHistoricalEvent(
          event,
          todayKey
        )
    );

  const historicalOutput = {
    generatedAt:
      new Date().toISOString(),

    throughDate:
      todayKey,

    eventCount:
      historicalEvents.length,

    events:
      historicalEvents
  };

  await fs.mkdir(
    DATA_DIR,
    {
      recursive: true
    }
  );

  await Promise.all([
    fs.writeFile(
      OUTPUT_FILE,
      JSON.stringify(
        output,
        null,
        2
      ) + "\n",
      "utf8"
    ),

    fs.writeFile(
      HISTORY_FILE,
      JSON.stringify(
        historicalOutput,
        null,
        2
      ) + "\n",
      "utf8"
    )
  ]);

  console.log(
    `Programación fusionada: ${merged.length} elementos`
  );

  console.log(
    `Festejos: ${bullfightingEventCount}`
  );

  console.log(
    `Programas taurinos: ${programCount}`
  );

  console.log(
    `Histórico permanente: ${historicalEvents.length} elementos`
  );

  console.log(
    `Candidatos históricos leídos: ${mergeStats.historicalCandidates}`
  );

  console.log(
    `Históricos añadidos: ${mergeStats.historicalPreserved}`
  );

  console.log(
    `Duplicados históricos fusionados: ${mergeStats.historicalDuplicatesMerged}`
  );

  console.log(
    `Coincidencias nuevas fusionadas: ${mergeStats.merged}`
  );

  console.log(
    `Fuentes degradadas: ${
      output.degraded
        ? "sí"
        : "no"
    }`
  );

  console.log(
    `Salida: ${OUTPUT_FILE}`
  );

  console.log(
    `Archivo histórico: ${HISTORY_FILE}`
  );
}

main().catch(
  error => {
    console.error(
      "Error fusionando la programación:"
    );

    console.error(
      error
    );

    process.exit(
      1
    );
  }
);
