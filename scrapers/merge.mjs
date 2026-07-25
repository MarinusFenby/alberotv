import fs from "node:fs/promises";

function normalizeText(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(name = "") {
  return String(name)
    .replace(/\s*\(\d{2}\/\d{2}\/\d{4}\)\s*$/, "")
    .trim();
}

function similarity(a = "", b = "") {
  const aWords = new Set(
    normalizeText(a)
      .split(" ")
      .filter(Boolean)
  );

  const bWords = new Set(
    normalizeText(b)
      .split(" ")
      .filter(Boolean)
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

  return matches / Math.max(aWords.size, bWords.size);
}

function findMatchingOneToro(event, oneToroEvents) {
  const sameDate = oneToroEvents.filter(
    item => item.date === event.date
  );

  let bestMatch = null;
  let bestScore = 0;

  for (const item of sameDate) {
    const score = similarity(
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
      muletazoEvent.id ||
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

    contentType:
      muletazoEvent.contentType ||
      "festejo",

    breeding:
      muletazoEvent.breeding ||
      "",

    participants:
      muletazoEvent.participants ||
      [],

    name:
      cleanName(
        oneToroEvent?.name ||
        muletazoEvent.name ||
        muletazoEvent.location ||
        muletazoEvent.type
      ),

    title:
      muletazoEvent.title ||
      null,

    image:
      oneToroEvent?.image ||
      muletazoEvent.image ||
      null,

    eventUrl:
      oneToroEvent?.sourceUrl ||
      muletazoEvent.eventUrl ||
      muletazoEvent.sourceUrl ||
      null,

    sourceUrl:
      muletazoEvent.sourceUrl ||
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

function convertOneToroEvent(
  oneToroEvent
) {
  return {
    id:
      oneToroEvent.id ||
      null,

    date:
      oneToroEvent.date,

    time:
      oneToroEvent.time ||
      null,

    channel:
      "OneToro",

    location:
      cleanName(
        oneToroEvent.name
      ),

    type:
      oneToroEvent.type ||
      "Festejo taurino",

    contentType:
      "festejo",

    breeding:
      oneToroEvent.breeding ||
      "",

    participants:
      oneToroEvent.participants ||
      [],

    name:
      cleanName(
        oneToroEvent.name
      ),

    title:
      oneToroEvent.title ||
      null,

    image:
      oneToroEvent.image ||
      null,

    eventUrl:
      oneToroEvent.sourceUrl ||
      null,

    sourceUrl:
      oneToroEvent.sourceUrl ||
      null,

    sources: [
      "OneToro"
    ]
  };
}

function convertProgramEvent(
  programEvent
) {
  return {
    id:
      programEvent.id ||
      null,

    date:
      programEvent.date,

    time:
      programEvent.time ||
      null,

    channel:
      programEvent.channel ||
      programEvent.source ||
      "Televisión",

    location:
      programEvent.location ||
      "Televisión",

    type:
      programEvent.type ||
      "Programa taurino",

    contentType:
      "programa",

    breeding:
      "",

    participants:
      [],

    name:
      programEvent.title ||
      programEvent.name ||
      "Programa taurino",

    title:
      programEvent.title ||
      programEvent.name ||
      "Programa taurino",

    image:
      programEvent.image ||
      null,

    eventUrl:
      programEvent.eventUrl ||
      programEvent.sourceUrl ||
      null,

    sourceUrl:
      programEvent.sourceUrl ||
      null,

    sources: [
      programEvent.source ||
      programEvent.channel ||
      "Programa taurino"
    ]
  };
}

function isSameProgram(
  firstEvent,
  secondEvent
) {
  return (
    firstEvent.date ===
      secondEvent.date &&
    firstEvent.time ===
      secondEvent.time &&
    normalizeText(
      firstEvent.title ||
      firstEvent.name
    ) ===
      normalizeText(
        secondEvent.title ||
        secondEvent.name
      )
  );
}

async function readJson(filePath) {
  const raw = await fs.readFile(
    filePath,
    "utf8"
  );

  return JSON.parse(raw);
}

async function readOptionalJson(
  filePath,
  defaultValue = {}
) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(
        `Archivo opcional no encontrado: ${filePath}`
      );

      return defaultValue;
    }

    throw error;
  }
}

async function main() {
  const muletazo = await readJson(
    "data/elmuletazo.json"
  );

  const oneToro = await readJson(
    "data/onetoro.json"
  );

  const programas =
    await readOptionalJson(
      "data/programas-taurinos.json",
      {
        events: []
      }
    );

  const oneToroEvents =
    oneToro.events ||
    [];

  const programEvents =
    programas.events ||
    [];

  const merged = [];

  /*
    Primero añadimos los eventos
    procedentes de El Muletazo.
  */

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
      merged.push(
        convertOneToroEvent(
          oneToroEvent
        )
      );
    }
  }

  /*
    Añadimos los programas taurinos.

    No se mezclan con los festejos,
    porque tienen contentType "programa".
  */

  for (
    const programEvent
    of programEvents
  ) {
    const convertedProgram =
      convertProgramEvent(
        programEvent
      );

    const alreadyIncluded =
      merged.some(
        event =>
          event.contentType ===
            "programa" &&
          isSameProgram(
            event,
            convertedProgram
          )
      );

    if (!alreadyIncluded) {
      merged.push(
        convertedProgram
      );
    }
  }

  /*
    Orden:
    1. Fecha
    2. Hora
    3. Nombre
  */

  merged.sort(
    (a, b) => {
      const dateComparison =
        String(a.date || "")
          .localeCompare(
            String(b.date || "")
          );

      if (dateComparison !== 0) {
        return dateComparison;
      }

      const timeComparison =
        String(
          a.time ||
          "99:99"
        ).localeCompare(
          String(
            b.time ||
            "99:99"
          )
        );

      if (timeComparison !== 0) {
        return timeComparison;
      }

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
    }
  );

  const programCount =
    merged.filter(
      event =>
        event.contentType ===
        "programa"
    ).length;

  const bullfightingEventCount =
    merged.length -
    programCount;

  const output = {
    generatedAt:
      new Date()
        .toISOString(),

    eventCount:
      merged.length,

    bullfightingEventCount,

    programCount,

    sources: {
      elMuletazo:
        muletazo.events?.length ||
        0,

      oneToro:
        oneToroEvents.length,

      programasTaurinos:
        programEvents.length
    },

    events:
      merged
  };

  await fs.writeFile(
    "data/programacion.json",
    JSON.stringify(
      output,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    `Programación fusionada: ${merged.length} elementos`
  );

  console.log(
    `Festejos: ${bullfightingEventCount}`
  );

  console.log(
    `Programas taurinos: ${programCount}`
  );
}

main().catch(error => {
  console.error(
    "Error fusionando la programación:"
  );

  console.error(error);

  process.exit(1);
});
