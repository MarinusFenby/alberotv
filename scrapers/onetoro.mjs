import fs from "node:fs/promises";

const API_URL =
  "https://galgo-onetoro.galgo.tv/container/ultimos-dos-festejos?page=1&size=300&version=2&language=es&image-format=webp";

function parseDateFromName(name = "") {
  const match = name.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);

  if (!match) return null;

  const [, day, month, year] = match;

  return `${year}-${month}-${day}`;
}

const MONTHS = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05",
  junio: "06", julio: "07", agosto: "08", septiembre: "09",
  setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12"
};

function parseDateFromText(text = "") {
  const numeric = String(text).match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})\b/);
  if (numeric) {
    return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }

  const written = String(text).toLowerCase().match(
    /\b(\d{1,2})(?:\s+de)?\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+(20\d{2})\b/
  );
  return written
    ? `${written[3]}-${MONTHS[written[2]]}-${written[1].padStart(2, "0")}`
    : null;
}

function collectPublicText(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string") return [cleanName(value)];
  if (Array.isArray(value)) {
    return value.flatMap(entry => collectPublicText(entry, depth + 1));
  }
  if (typeof value !== "object") return [];

  const ignored = /^(?:_id|id|slug|url|href|image|thumbnail|token|key)$/i;
  return Object.entries(value).flatMap(([key, entry]) =>
    ignored.test(key) ? [] : collectPublicText(entry, depth + 1)
  );
}

function extractExplicitStartTime(text = "") {
  const normalized = cleanName(text).toLowerCase();
  const patterns = [
    /(?:comienza|comenzamos|empieza|inicio|arranca|en directo|conexi[oó]n|a partir de|desde)\s*(?:hoy|esta tarde|esta noche)?\s*(?:a|desde|a partir de)?\s*(?:las|la)?\s*([01]?\d|2[0-3])(?:[:h.]([0-5]\d))?\s*(?:h(?:oras?)?)?\b/i,
    /(?:hoy|esta tarde|esta noche)\s*(?:a|desde|a partir de)\s*(?:las|la)?\s*([01]?\d|2[0-3])(?:[:h.]([0-5]\d))?\s*(?:h(?:oras?)?)?\b/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return `${match[1].padStart(2, "0")}:${match[2] || "00"}`;
  }
  return null;
}

function cleanName(name = "") {
  return name.replace(/\s+/g, " ").trim();
}

function normalizeKey(value = "") {
  return cleanName(String(value))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractCartelDetails(publicText = "", labels = []) {
  const segments = String(publicText)
    .split(" · ")
    .map(cleanName)
    .filter(Boolean);
  const cartelText = segments.find(segment =>
    /\b(?:toros?|novillos?|reses)\s+de\s+.+?\s+para\s+/i.test(segment)
  ) || "";
  const match = cartelText.match(
    /\b(?:toros?|novillos?|reses)\s+de\s+(.+?)\s+para\s+(.+?)(?:\.|$)/i
  );

  if (!match) {
    return { breeding: "", participants: [], location: "" };
  }

  const breeding = cleanName(match[1]);
  const participants = cleanName(match[2])
    .replace(/\s+(?:y|e)\s+/gi, ",")
    .split(",")
    .map(cleanName)
    .filter(Boolean);
  const breedingKey = normalizeKey(breeding);
  const participantKeys = participants.map(normalizeKey);
  const junk = /^(?:register|video|festejos?|novillada|corrida(?: de toros)?|rejones?|recortes?|tematica|proximos|etiqueta|pegi|16)$/;

  const location = labels
    .map(cleanName)
    .find(label => {
      const key = normalizeKey(label);
      if (!key || junk.test(key)) return false;
      if (key.includes(breedingKey) || breedingKey.includes(key)) return false;
      return !participantKeys.some(participantKey =>
        key.includes(participantKey) || participantKey.includes(key)
      );
    }) || "";

  return { breeding, participants, location };
}

function extractItems(data) {
  const possibleArrays = [
    data.contents,
    data.content,
    data.items,
    data.videos,
    data.children
  ];

  for (const array of possibleArrays) {
    if (Array.isArray(array)) {
      return array;
    }
  }

  for (const value of Object.values(data)) {
    if (
      Array.isArray(value) &&
      value.some(
        item =>
          item &&
          typeof item === "object" &&
          (item.name || item.analytics?.name)
      )
    ) {
      return value;
    }
  }

  return [];
}

async function main() {
  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error(
      `Error OneToro API: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();

  const items = extractItems(data);

  const events = items
    .filter(item => item?.itemType === "Video")
    .map(item => {
      const name = cleanName(
        item.name ||
        item.analytics?.name ||
        ""
      );

      const labels =
        item.layout?.LABEL ||
        item.layout?.label?.map(label => label.value) ||
        [];

      const publicText = [...new Set(collectPublicText(item).filter(Boolean))]
        .join(" · ");
      const cartel = extractCartelDetails(publicText, labels);
      const date = parseDateFromName(name) || parseDateFromText(publicText);
      const time = extractExplicitStartTime(publicText);
      const isProgram = /conexi[oó]n\s+dax/i.test(`${name} ${publicText}`);
      const classificationText = `${name} ${publicText}`;
      const inferredType = /\bnovillada\b|\bnovillos?\s+de\b/i.test(classificationText)
        ? "Novillada"
        : (/\brejones?\b|\brejoneo\b/i.test(classificationText)
            ? "Rejones"
            : (/\brecortadores?\b|\brecortes?\b/i.test(classificationText)
                ? "Recortes"
                : (/\bcorrida\b|\btoros?\s+de\b/i.test(classificationText)
                    ? "Corrida de toros"
                    : null)));

      return {
        id: item._id || null,
        name,
        date,
        time,
        channel: "OneToro",
        type: isProgram ? "Programa taurino" : inferredType,
        contentType: isProgram ? "programa" : "festejo",
        breeding: cartel.breeding,
        participants: cartel.participants.length ? cartel.participants : labels,
        location: cartel.location,
        slug: item.slug || null,

        image:
          item.thumbnail?.landscape ||
          item.thumbnail?.landscapes?.[0]?.url ||
          null,

        sourceUrl:
          item.slug
            ? `https://festejos.onetoro.tv/content/${item.slug}`
            : null,

        published: item.published ?? null,
        live: item.live ?? null,
        sourceText: publicText
      };
    })
    .filter(event => event.name && event.date);

  const result = {
    source: "OneToro",
    sourceUrl: API_URL,
    fetchedAt: new Date().toISOString(),
    eventCount: events.length,
    events
  };

  await fs.mkdir("data", {
    recursive: true
  });

  await fs.writeFile(
    "data/onetoro.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log(
    `OneToro: ${events.length} eventos guardados`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
