import fs from "node:fs/promises";

function normalizeText(text = "") {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(name = "") {
  return name
    .replace(/\s*\(\d{2}\/\d{2}\/\d{4}\)\s*$/, "")
    .trim();
}

function eventKey(event) {
  const date =
    event.date || "";

  const location =
    normalizeText(
      event.location ||
      cleanName(event.name || "")
    );

  return `${date}|${location}`;
}

function similarity(a = "", b = "") {
  const aWords =
    new Set(
      normalizeText(a).split(" ").filter(Boolean)
    );

  const bWords =
    new Set(
      normalizeText(b).split(" ").filter(Boolean)
    );

  if (!aWords.size || !bWords.size) {
    return 0;
  }

  let matches = 0;

  for (const word of aWords) {
    if (bWords.has(word)) {
      matches++;
    }
  }

  return matches /
    Math.max(
      aWords.size,
      bWords.size
    );
}

function findMatchingOneToro(
  event,
  oneToroEvents
) {
  const sameDate =
    oneToroEvents.filter(
      item =>
        item.date ===
        event.date
    );

  let bestMatch = null;
  let bestScore = 0;

  for (const item of sameDate) {
    const score =
      similarity(
        event.location,
        item.name
      );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestScore >= 0.35
    ? bestMatch
    : null;
}

function mergeEvent(
  muletazoEvent,
  oneToroEvent
) {
  return {
    id:
      oneToroEvent?.id ||
      null,

    date:
      muletazoEvent.date,

    time:
      muletazoEvent.time ||
      null,

    channel:
      muletazoEvent.channel,

    location:
      muletazoEvent.location,

    type:
      muletazoEvent.type,

    breeding:
      muletazoEvent.breeding ||
      "",

    participants:
      muletazoEvent.participants ||
      [],

    name:
      cleanName(
        oneToroEvent?.name ||
        muletazoEvent.location ||
        muletazoEvent.type
      ),

    image:
      oneToroEvent?.image ||
      null,

    eventUrl:
      oneToroEvent?.sourceUrl ||
      null,

    sources: [
      "El Muletazo",
      ...(oneToroEvent
        ? ["OneToro"]
        : [])
    ]
  };
}

async function readJson(path) {
  const raw =
    await fs.readFile(
      path,
      "utf8"
    );

  return JSON.parse(raw);
}

async function main() {
  const muletazo =
    await readJson(
      "data/elmuletazo.json"
    );

  const oneToro =
    await readJson(
      "data/onetoro.json"
    );

  const oneToroEvents =
    oneToro.events || [];

  const merged = [];

  for (
    const event
    of muletazo.events || []
  ) {
    const oneToroMatch =
      event.channel === "OneToro"
        ? findMatchingOneToro(
            event,
            oneToroEvents
          )
        : null;

    merged.push(
      mergeEvent(
        event,
        oneToroMatch
      )
    );
  }

  /*
    Añadimos cualquier evento OneToro
    que no haya aparecido en El Muletazo.
  */

  for (
    const oneToroEvent
    of oneToroEvents
  ) {
    const alreadyIncluded =
      merged.some(
        event =>
          event.sources.includes(
            "OneToro"
          ) &&
          event.date ===
            oneToroEvent.date &&
          similarity(
            event.location ||
            event.name,
            oneToroEvent.name
          ) >= 0.35
      );

    if (!alreadyIncluded) {
      merged.push({
        id:
          oneToroEvent.id ||
          null,

        date:
          oneToroEvent.date,

        time:
          null,

        channel:
          "OneToro",

        location:
          cleanName(
            oneToroEvent.name
          ),

        type:
          "Festejo taurino",

        breeding:
          "",

        participants:
          oneToroEvent.participants ||
          [],

        name:
          cleanName(
            oneToroEvent.name
          ),

        image:
          oneToroEvent.image ||
          null,

        eventUrl:
          oneToroEvent.sourceUrl ||
          null,

        sources: [
          "OneToro"
        ]
      });
    }
  }

  merged.sort(
    (a, b) =>
      `${a.date} ${a.time || "99:99"}`
        .localeCompare(
          `${b.date} ${b.time || "99:99"}`
        )
  );

  const output = {
    generatedAt:
      new Date()
        .toISOString(),

    eventCount:
      merged.length,

    events:
      merged
  };

  await fs.writeFile(
    "data/programacion.json",
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `Programación fusionada: ${merged.length} eventos`
  );
}

main().catch(
  error => {
    console.error(error);
    process.exit(1);
  }
);
