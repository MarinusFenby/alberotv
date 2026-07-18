import fs from "node:fs/promises";

const SOURCE_URL =
  "https://elmuletazo.com/agenda-de-toros-en-television/";

const MONTHS = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12"
};

function clean(text = "") {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChannel(text = "") {
  const value = text.toLowerCase();

  if (value.includes("onetoro")) {
    return "OneToro";
  }

  if (value.includes("canal sur")) {
    return "Canal Sur";
  }

  if (
    value.includes("castilla la mancha") ||
    value.includes("cmm")
  ) {
    return "CMM";
  }

  if (value.includes("telemadrid")) {
    return "Telemadrid";
  }

  if (value.includes("à punt")) {
    return "À Punt";
  }

  if (
    value.includes(
      "la 7 de castilla"
    )
  ) {
    return "La 7 CyL";
  }

  if (
    value.includes(
      "toros en españa"
    )
  ) {
    return "Toros en España Play";
  }

  return "";
}

function parseDate(text = "") {
  const match = text.match(
    /(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i
  );

  if (!match) {
    return null;
  }

  const day =
    match[1].padStart(2, "0");

  const month =
    MONTHS[
      match[2].toLowerCase()
    ];

  const year =
    match[3];

  return `${year}-${month}-${day}`;
}

function parseTime(text = "") {
  const match =
    text.match(
      /(\d{1,2}):(\d{2})h/i
    );

  if (!match) {
    return null;
  }

  return `${match[1].padStart(
    2,
    "0"
  )}:${match[2]}`;
}

function extractLocation(text = "") {
  let match =
    text.match(
      /Toros desde ([^.]+)\./i
    );

  if (match) {
    return clean(
      match[1]
    );
  }

  match =
    text.match(
      /Desde ([^.]+)\./i
    );

  if (match) {
    return clean(
      match[1]
    );
  }

  return "";
}

function extractType(text = "") {
  const types = [
    "Corrida de Toros",
    "Novillada con picadores",
    "Novillada sin picadores",
    "Rejones a la portuguesa",
    "Corrida de Rejones",
    "Festival",
    "Concurso de Recortadores"
  ];

  for (const type of types) {
    if (
      text
        .toLowerCase()
        .includes(
          type.toLowerCase()
        )
    ) {
      return type;
    }
  }

  return "Festejo taurino";
}

function extractBreeding(text = "") {
  const patterns = [
    /Toros de ([^.]+?) para[:\s]/i,
    /Novillos de ([^.]+?) para[:\s]/i,
    /Reses de ([^.]+?) para[:\s]/i
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      text.match(pattern);

    if (match) {
      return clean(
        match[1]
      );
    }
  }

  return "";
}

function extractParticipants(
  text = ""
) {
  const match =
    text.match(
      /\bpara:\s*(.+?)(?:\.\s*\(|\.$|$)/i
    ) ||
    text.match(
      /\bpara\s+(.+?)(?:\.\s*\(|\.$|$)/i
    );

  if (!match) {
    return [];
  }

  return clean(match[1])
    .replace(/\sy\s/g, ", ")
    .split(",")
    .map(clean)
    .filter(Boolean);
}

function splitEntries(
  text
) {
  return text
    .split(
      /(?=(?:Lunes|Martes|Miércoles|Miercoles|Jueves|Viernes|Sábado|Sabado|Domingo)\s+\d{1,2}\s+de\s+)/i
    )
    .map(clean)
    .filter(
      block =>
        parseDate(block)
    );
}

async function main() {
  const response =
    await fetch(
      SOURCE_URL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 AlberoTV/1.0"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Error El Muletazo: ${response.status}`
    );
  }

  const html =
    await response.text();

  const plainText =
    clean(
      html
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          " "
        )
        .replace(
          /<style[\s\S]*?<\/style>/gi,
          " "
        )
        .replace(
          /<[^>]+>/g,
          " "
        )
        .replace(
          /&nbsp;/g,
          " "
        )
        .replace(
          /&amp;/g,
          "&"
        )
        .replace(
          /&#8211;|&ndash;/g,
          "-"
        )
    );

  const blocks =
    splitEntries(
      plainText
    );

  const events =
    blocks
      .map(block => ({
        source:
          "El Muletazo",

        date:
          parseDate(
            block
          ),

        time:
          parseTime(
            block
          ),

        channel:
          normalizeChannel(
            block
          ),

        location:
          extractLocation(
            block
          ),

        type:
          extractType(
            block
          ),

        breeding:
          extractBreeding(
            block
          ),

        participants:
          extractParticipants(
            block
          ),

        sourceUrl:
          SOURCE_URL,

        sourceText:
          block
      }))
      .filter(
        event =>
          event.date &&
          event.channel
      );

  const output = {
    source:
      "El Muletazo",

    fetchedAt:
      new Date()
        .toISOString(),

    eventCount:
      events.length,

    events
  };

  await fs.mkdir(
    "data",
    {
      recursive: true
    }
  );

  await fs.writeFile(
    "data/elmuletazo.json",
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `El Muletazo: ${events.length} eventos extraídos`
  );
}

main().catch(
  error => {
    console.error(error);
    process.exit(1);
  }
);
