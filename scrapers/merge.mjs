import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = "data";
const OUTPUT_FILE = path.join(DATA_DIR, "programacion.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const SOURCE_FILES = {
  elMuletazo: path.join(DATA_DIR, "elmuletazo.json"),
  oneToro: path.join(DATA_DIR, "onetoro.json"),
  programasTaurinos: path.join(DATA_DIR, "programas-taurinos.json"),
  canalSur: path.join(DATA_DIR, "canalsur.json")
};

const SOURCE_LABELS = {
  elMuletazo: "El Muletazo",
  oneToro: "OneToro",
  programasTaurinos: "Programas taurinos",
  canalSur: "Canal Sur"
};

const SOURCE_CONFIDENCE = {
  "Canal Sur": 98,
  OneToro: 96,
  "El Muletazo": 90,
  "Programas taurinos": 88,
  Telemadrid: 98,
  CMM: 98,
  RTVE: 98,
  "La 7 CyL": 98,
  "Toros en España Play": 94
};

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
  return cleanName(String(value).replace(/^ganader[ií]a\s*:\s*/i, ""));
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

function normalizeType(type = "") {
  const value = normalizeText(type);

  if (!value) return "Festejo taurino";
  if (value.includes("programa")) return "Programa taurino";
  if (value.includes("rejones") || value.includes("rejoneo")) return "Rejones";
  if (value.includes("novillada") && value.includes("sin picadores")) return "Novillada sin picadores";
  if (value.includes("novillada") && value.includes("picadores")) return "Novillada con picadores";
  if (value.includes("novillada")) return "Novillada";
  if (value.includes("corrida") && value.includes("mixta")) return "Corrida mixta";
  if (value.includes("corrida")) return "Corrida de toros";
  if (value.includes("recortadores")) return "Concurso de recortadores";

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

function eventMatchScore(first, second) {
  if (!first?.date || first.date !== second?.date) return 0;
  if (first.contentType !== second.contentType) return 0;

  let score = 40;

  const locationScore = similarity(
    first.location || first.name,
    second.location || second.name
  );

  score += locationScore * 35;

  const channelA = normalizeChannel(first.channel);
  const channelB = normalizeChannel(second.channel);
  if (channelA === channelB) score += 8;

  score += timeCloseness(first.time, second.time) * 7;
  score += participantSimilarity(first.participants, second.participants) * 7;

  const breedingScore = similarity(first.breeding, second.breeding);
  score += breedingScore * 3;

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
  const contentType = event.contentType === "programa" || normalizeType(event.type) === "Programa taurino"
    ? "programa"
    : "festejo";

  const normalized = {
    id: event.id || null,
    date: event.date || null,
    time: event.time || null,
    channel: normalizeChannel(event.channel || sourceName),
    location: cleanName(event.location || event.name || "Televisión"),
    type: contentType === "programa"
      ? "Programa taurino"
      : normalizeType(event.type),
    contentType,
    breeding: contentType === "programa" ? "" : cleanBreeding(event.breeding),
    participants: contentType === "programa" ? [] : cleanParticipants(event.participants),
    name: cleanName(event.name || event.title || event.location || event.type || "Festejo taurino"),
    title: event.title ? cleanName(event.title) : null,
    image: event.image || null,
    eventUrl: event.eventUrl || event.sourceUrl || null,
    sourceUrl: event.sourceUrl || event.eventUrl || null,
    sources: [sourceName],
    sourceDetails: [
      createSourceDetail(sourceName, event.sourceUrl || event.eventUrl, fetchedAt)
    ]
  };

  normalized.confidence = calculateConfidence(normalized);
  normalized.status = normalized.confidence >= 94 ? "confirmed" : "probable";

  return normalized;
}

function normalizeOneToroEvent(event, fetchedAt = null) {
  const normalized = normalizeGenericEvent(
    {
      ...event,
      channel: "OneToro",
      location: cleanName(event.name),
      contentType: "festejo"
    },
    "OneToro",
    fetchedAt
  );

  normalized.eventUrl = event.sourceUrl || null;
  normalized.sourceUrl = event.sourceUrl || null;
  return normalized;
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

function normalizeProgramEvent(event, fallbackSource = "Programas taurinos", fetchedAt = null) {
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
  const firstEmpty = firstValue === null || firstValue === undefined || firstValue === "";
  const secondEmpty = secondValue === null || secondValue === undefined || secondValue === "";

  if (firstEmpty && !secondEmpty) return secondValue;
  if (!firstEmpty && secondEmpty) return firstValue;
  if (firstEmpty && secondEmpty) return firstValue ?? secondValue ?? null;

  return preferSecond ? secondValue : firstValue;
}

function mergeParticipants(first = [], second = []) {
  const output = [...first];

  for (const candidate of second) {
    const exists = output.some(current => similarity(current, candidate) >= 0.75);
    if (!exists) output.push(candidate);
  }

  return output;
}

function mergeTwoEvents(first, second) {
  const secondIsOfficial = sourceConfidence(second.sources?.[0]) > sourceConfidence(first.sources?.[0]);

  const merged = {
    ...first,
    id: chooseValue(first.id, second.id, secondIsOfficial),
    date: chooseValue(first.date, second.date, secondIsOfficial),
    time: chooseValue(first.time, second.time, secondIsOfficial),
    channel: chooseValue(first.channel, second.channel, secondIsOfficial),
    location: chooseValue(first.location, second.location, secondIsOfficial),
    type: chooseValue(first.type, second.type, secondIsOfficial),
    contentType: first.contentType || second.contentType || "festejo",
    breeding: chooseValue(first.breeding, second.breeding, secondIsOfficial),
    participants: mergeParticipants(first.participants, second.participants),
    name: chooseValue(first.name, second.name, secondIsOfficial),
    title: chooseValue(first.title, second.title, secondIsOfficial),
    image: chooseValue(first.image, second.image, secondIsOfficial),
    eventUrl: chooseValue(first.eventUrl, second.eventUrl, secondIsOfficial),
    sourceUrl: chooseValue(first.sourceUrl, second.sourceUrl, secondIsOfficial),
    sources: [...new Set([...(first.sources || []), ...(second.sources || [])])],
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

  const threshold = candidate.contentType === "programa" ? 82 : 68;

  if (bestIndex >= 0 && bestScore >= threshold) {
    collection[bestIndex] = mergeTwoEvents(collection[bestIndex], candidate);
    return { merged: true, score: bestScore };
  }

  collection.push(candidate);
  return { merged: false, score: bestScore };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
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
    output.events.length < Math.floor(previousOutput.events.length * 0.4)
  ) {
    errors.push(
      `Caída sospechosa de eventos: ${previousOutput.events.length} → ${output.events.length}`
    );
  }

  return errors;
}

async function readPreviousOutput() {
  try {
    return await readJson(OUTPUT_FILE);
  } catch {
    return null;
  }
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function backupPreviousOutput(previousOutput) {
  if (!previousOutput) return null;

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(
    BACKUP_DIR,
    `programacion-${safeTimestamp()}.json`
  );

  await fs.writeFile(
    backupFile,
    JSON.stringify(previousOutput, null, 2) + "\n",
    "utf8"
  );

  return backupFile;
}

function sortEvents(events) {
  events.sort((a, b) => {
    const dateComparison = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateComparison !== 0) return dateComparison;

    const timeComparison = String(a.time || "99:99").localeCompare(String(b.time || "99:99"));
    if (timeComparison !== 0) return timeComparison;

    return String(a.name || a.title || "").localeCompare(
      String(b.name || b.title || ""),
      "es"
    );
  });

  return events;
}

async function main() {
  const [muletazo, oneToro, programas, canalSur] = await Promise.all([
    readSource("elMuletazo"),
    readSource("oneToro"),
    readSource("programasTaurinos"),
    readSource("canalSur")
  ]);

  const sourceResults = [muletazo, oneToro, programas, canalSur];

  if (!sourceResults.some(source => source.ok)) {
    throw new Error("Todas las fuentes han fallado. Se conserva programacion.json.");
  }

  const merged = [];
  const mergeStats = {
    added: 0,
    merged: 0
  };

  for (const event of muletazo.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeMuletazoEvent(event, muletazo.fetchedAt)
    );
    mergeStats[result.merged ? "merged" : "added"] += 1;
  }

  for (const event of oneToro.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeOneToroEvent(event, oneToro.fetchedAt)
    );
    mergeStats[result.merged ? "merged" : "added"] += 1;
  }

  for (const event of canalSur.data.events || []) {
    const normalized = event.contentType === "programa"
      ? normalizeProgramEvent(event, "Canal Sur", canalSur.fetchedAt)
      : normalizeGenericEvent(event, "Canal Sur", canalSur.fetchedAt);

    const result = addOrMergeEvent(merged, normalized);
    mergeStats[result.merged ? "merged" : "added"] += 1;
  }

  for (const event of programas.data.events || []) {
    const result = addOrMergeEvent(
      merged,
      normalizeProgramEvent(event, "Programas taurinos", programas.fetchedAt)
    );
    mergeStats[result.merged ? "merged" : "added"] += 1;
  }

  sortEvents(merged);

  const programCount = merged.filter(event => event.contentType === "programa").length;
  const bullfightingEventCount = merged.length - programCount;

  const sourceHealth = Object.fromEntries(
    sourceResults.map(source => [
      source.key,
      {
        label: source.label,
        status: source.ok ? "ok" : "error",
        eventCount: source.eventCount,
        fetchedAt: source.fetchedAt,
        error: source.error
      }
    ])
  );

  const output = {
    generatedAt: new Date().toISOString(),
    degraded: sourceResults.some(source => !source.ok),
    eventCount: merged.length,
    bullfightingEventCount,
    programCount,
    mergeStats,
    sources: {
      elMuletazo: muletazo.eventCount,
      oneToro: oneToro.eventCount,
      programasTaurinos: programas.eventCount,
      canalSur: canalSur.eventCount
    },
    sourceHealth,
    events: merged
  };

  const previousOutput = await readPreviousOutput();
  const validationErrors = validateOutput(output, previousOutput);

  if (validationErrors.length > 0) {
    console.error("No se publica la nueva programación por errores de validación:");
    for (const error of validationErrors.slice(0, 20)) {
      console.error(`- ${error}`);
    }

    if (validationErrors.length > 20) {
      console.error(`- ... y ${validationErrors.length - 20} errores más`);
    }

    process.exitCode = 1;
    return;
  }

  const backupFile = await backupPreviousOutput(previousOutput);

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`Programación fusionada: ${merged.length} elementos`);
  console.log(`Festejos: ${bullfightingEventCount}`);
  console.log(`Programas taurinos: ${programCount}`);
  console.log(`Coincidencias fusionadas: ${mergeStats.merged}`);
  console.log(`Fuentes degradadas: ${output.degraded ? "sí" : "no"}`);
  console.log(`Salida: ${OUTPUT_FILE}`);

  if (backupFile) {
    console.log(`Copia de seguridad: ${backupFile}`);
  }
}

main().catch(error => {
  console.error("Error fusionando la programación:");
  console.error(error);
  process.exit(1);
});
