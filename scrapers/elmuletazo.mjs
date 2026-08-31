import fs from "node:fs/promises";

const SOURCE_URL =
  "https://elmuletazo.com/agenda-de-toros-en-television/";

const OUTPUT_FILE =
  "data/elmuletazo.json";

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

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&#(\d+);/g, (_, number) =>
      String.fromCodePoint(Number(number))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      String.fromCodePoint(parseInt(number, 16))
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&laquo;|&#171;/gi, "«")
    .replace(/&raquo;|&#187;/gi, "»")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&mdash;|&#8212;/gi, "—");
}

function clean(text = "") {
  return decodeHtmlEntities(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text = "") {
  return clean(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cleanBreeding(text = "") {
  return clean(text)
    .replace(/^[«»"'“”]+/, "")
    .replace(/[«»"'“”]+$/, "")
    .replace(/[.。]+$/, "")
    .trim();
}

function cleanParticipant(text = "") {
  return clean(text)
    .replace(/[.。]?\s*🔗.*$/i, "")
    .replace(/\s*\(Pulsa aquí.*$/i, "")
    .replace(/\s*o también\s*\(Pulsa aquí.*$/i, "")
    .replace(/\s*que tomará la alternativa.*$/i, "")
    .replace(/[.。]+$/, "")
    .trim();
}

function isJunkParticipant(text = "") {
  const value = normalizeText(text);

  return (
    !value ||
    value.startsWith("acceder a la emision") ||
    value.startsWith("pulsa aqui") ||
    value.includes("emision en directo") ||
    value.includes("emision en ppv") ||
    value.includes("servicio gratis") ||
    value.includes("me gusta responder")
  );
}

function isolateAgendaHtml(html = "") {
  let isolated = String(html);

  const commentMarkers = [
    /<section[^>]+id=["']comments["'][\s\S]*$/i,
    /<div[^>]+id=["']comments["'][\s\S]*$/i,
    /<ol[^>]+class=["'][^"']*comment-list[^"']*["'][\s\S]*$/i,
    /<div[^>]+class=["'][^"']*comments-area[^"']*["'][\s\S]*$/i,
    /<h2[^>]*>\s*\d+\s+comentarios?[\s\S]*$/i,
    /<h3[^>]*>\s*comentarios?[\s\S]*$/i
  ];

  for (const marker of commentMarkers) {
    isolated = isolated.replace(marker, "");
  }

  return isolated;
}

function htmlToPlainText(html = "") {
  return clean(
    isolateAgendaHtml(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(?:p|div|li|article|section|h1|h2|h3|h4|h5|h6|br)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractRawChannel(text = "") {
  const block = clean(text);

  const match = block.match(
    /📺\s*(.+?)(?=\s*🏟|\s*🐂|\s*📜|\s*🔗|$)/i
  );

  if (!match || !match[1]) {
    return "";
  }

  return clean(match[1])
    .replace(/^[^0-9A-Za-zÀ-ÿ]+/, "")
    .replace(/[.·,;:\s]+$/, "")
    .trim();
}

function normalizeChannel(text = "") {
  const value = normalizeText(text);

  if (
    value.includes("101 television malaga") ||
    value.includes("101 tv malaga") ||
    value.includes("101 television") ||
    value.includes("101 tv")
  ) {
    return "101 TV Málaga";
  }

  if (value.includes("onetoro") || value.includes("one toro")) {
    return "OneToro";
  }

  if (value.includes("canal sur")) {
    return "Canal Sur";
  }

  if (
    value.includes("canal extremadura") ||
    value.includes("extremadura tv") ||
    value.includes("extremadura television")
  ) {
    return "Canal Extremadura";
  }

  if (
    value.includes("castilla la mancha") ||
    value.includes("castilla-la mancha") ||
    /\bcmm\b/.test(value)
  ) {
    return "CMM";
  }

  if (value.includes("telemadrid") || value.includes("tele madrid")) {
    return "Telemadrid";
  }

  if (value.includes("a punt")) {
    return "À Punt";
  }

  if (
    value.includes("la 7 de castilla") ||
    value.includes("la 7 cyl") ||
    value.includes("cyltv")
  ) {
    return "La 7 CyL";
  }

  if (value.includes("toros en espana")) {
    return "Toros en España Play";
  }

  if (
    value.includes("aragon tv") ||
    value.includes("aragon television")
  ) {
    return "Aragón TV";
  }

  if (
    value.includes("rtpa") ||
    value.includes("television del principado de asturias")
  ) {
    return "RTPA";
  }

  /*
   * Canal todavía desconocido:
   * se conserva el nombre que aparece entre 📺 y 🏟.
   * Así las futuras cadenas no desaparecen del JSON.
   */
  const rawChannel = extractRawChannel(text);

  if (
    rawChannel &&
    rawChannel.length >= 2 &&
    rawChannel.length <= 60
  ) {
    console.warn(
      `Nuevo canal detectado automáticamente: ${rawChannel}`
    );

    return rawChannel;
  }

  return "";
}

function parseDate(text = "") {
  const match = clean(text).match(
    /(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i
  );

  if (!match) {
    return null;
  }

  const day = match[1].padStart(2, "0");
  const month = MONTHS[normalizeText(match[2])];
  const year = match[3];

  return `${year}-${month}-${day}`;
}

function parseTime(text = "") {
  const match = clean(text).match(
    /(\d{1,2})\s*:\s*(\d{2})\s*h?/i
  );

  if (!match) {
    return null;
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function extractLocation(text = "") {
  const patterns = [
    /Toros desde\s+([^.]+)\./i,
    /Desde\s+([^.]+)\./i
  ];

  for (const pattern of patterns) {
    const match = clean(text).match(pattern);

    if (match && match[1]) {
      return clean(match[1]);
    }
  }

  return "";
}

function extractMixedDetails(text = "") {
  const withoutLinks = clean(text).split("🔗")[0];
  const match = withoutLinks.match(
    /\b(?:Toros|Novillos)\s+para\s+rejones\s+de\s+(.+?)\s+y\s+para\s+la\s+lidia\s+a\s+pie\s+de\s+(.+?)\s+para\s+el\s+rejoneador\s+(.+?)\s+y\s+los\s+espadas?\s*:\s*(.+?)(?=[.。](?:\s|$)|$)/i
  );

  if (!match) {
    return null;
  }

  const rejonesBreeding = cleanBreeding(match[1])
    .replace(
      /^Ángel Sánchez y Sánchez$/i,
      "Hdros. de Ángel Sánchez y Sánchez"
    );
  const footBreeding = cleanBreeding(match[2])
    .replace(
      /\bVictoriano del Río\b(?!\s+Cortés)/i,
      "D. Victoriano del Río Cortés"
    );
  const rejoneador = cleanParticipant(match[3]);
  const matadors = clean(match[4])
    .replace(/\s+y\s+/gi, ", ")
    .replace(/\s+e\s+/gi, ", ")
    .split(",")
    .map(cleanParticipant)
    .filter(participant => !isJunkParticipant(participant));

  return {
    breeding: [rejonesBreeding, footBreeding].filter(Boolean).join(", "),
    participants: [rejoneador, ...matadors]
      .filter(participant => !isJunkParticipant(participant))
  };
}

function extractType(text = "") {
  const value = normalizeText(text);

  if (
    extractMixedDetails(text) ||
    (value.includes("rejones") && value.includes("lidia a pie")) ||
    (value.includes("rejoneador") && value.includes("espadas"))
  ) {
    return "Festejo mixto";
  }

  if (/\b(?:becerrada|becerradas|erales?)\b/.test(value)) {
    return "Novillada sin picadores";
  }

  if (/novilladas?\s+sin\s+(?:picadores|caballos)/.test(value)) {
    return "Novillada sin picadores";
  }

  if (/novilladas?\s+con\s+picadores/.test(value)) {
    return "Novillada con picadores";
  }

  const types = [
    ["encierro", "Encierro"],
    ["corrida de toros", "Corrida de toros"],
    ["novillada con picadores", "Novillada con picadores"],
    ["novillada sin picadores", "Novillada sin picadores"],
    ["novillada sin caballos", "Novillada sin picadores"],
    ["rejones a la portuguesa", "Rejones"],
    ["corrida de rejones", "Rejones"],
    ["rejones", "Rejones"],
    ["festival", "Festival"],
    ["concurso de recortadores", "Concurso de recortadores"],
    ["concurso de recortes", "Concurso de recortadores"]
  ];

  for (const [needle, result] of types) {
    if (value.includes(needle)) {
      return result;
    }
  }

  if (/\b(?:novillos?|utreros?)\s+de\b/.test(value)) {
    return "Novillada";
  }

  if (/circuito de novilladas con picadores/i.test(value)) {
    return "Novillada con picadores";
  }

  return "Festejo taurino";
}

function extractBreeding(text = "") {
  const mixedDetails = extractMixedDetails(text);

  if (mixedDetails?.breeding) {
    return mixedDetails.breeding;
  }

  const patterns = [
    /\bToros de\s+(.+?)(?=\s+para\s*:?\s|\s+Cartel por confirmar|\.?\s*🔗|$)/i,
    /\bNovillos de\s+(.+?)(?=\s+para\s*:?\s|\s+Cartel por confirmar|\.?\s*🔗|$)/i,
    /\bReses de\s+(.+?)(?=\s+para\s*:?\s|\s+Cartel por confirmar|\.?\s*🔗|$)/i
  ];

  for (const pattern of patterns) {
    const match = clean(text).match(pattern);

    if (match && match[1]) {
      const breeding = cleanBreeding(match[1]);

      if (
        breeding.length <= 180 &&
        !/servicio gratis|me gusta responder|comentarios?/i.test(breeding)
      ) {
        return breeding;
      }
    }
  }

  return "";
}

function extractParticipants(text = "") {
  const withoutLinks = clean(text).split("🔗")[0];

  const mixedDetails = extractMixedDetails(withoutLinks);

  if (mixedDetails) {
    return mixedDetails.participants;
  }

  if (/Cartel por confirmar/i.test(withoutLinks)) {
    return [];
  }

  const match =
    withoutLinks.match(/\bpara\s*:\s*(.+)$/i) ||
    withoutLinks.match(/\bpara\s+(.+)$/i);

  if (!match) {
    return [];
  }

  let participantsText = clean(match[1]);

  participantsText = participantsText
    .replace(/\s*,?\s*que tomará la alternativa.*$/i, "")
    .replace(/\s*\(Por una cuestión de derechos.*$/i, "")
    .replace(/\s*\(Pulsa aquí.*$/i, "")
    .trim();

  participantsText = participantsText
    .replace(/\s+y\s+/gi, ", ")
    .replace(/\s+e\s+/gi, ", ");

  return participantsText
    .split(",")
    .map(cleanParticipant)
    .filter(participant => !isJunkParticipant(participant));
}

function splitEntries(text = "") {
  return clean(text)
    .split(
      /(?=(?:Lunes|Martes|Miércoles|Miercoles|Jueves|Viernes|Sábado|Sabado|Domingo)\s+\d{1,2}\s+de\s+)/i
    )
    .map(clean)
    .filter(block => parseDate(block));
}

function createEvent(block = "") {
  return {
    source: "El Muletazo",
    date: parseDate(block),
    time: parseTime(block),
    channel: normalizeChannel(block),
    location: extractLocation(block),
    type: extractType(block),
    breeding: extractBreeding(block),
    participants: extractParticipants(block),
    sourceUrl: SOURCE_URL,
    sourceText: block
  };
}

async function main() {
  const response = await fetch(
    SOURCE_URL,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AlberoTV/1.0)",
        "Accept":
          "text/html,application/xhtml+xml"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Error El Muletazo: ${response.status}`
    );
  }

  const html = await response.text();
  const plainText = htmlToPlainText(html);
  const blocks = splitEntries(plainText);

  const events = blocks
    .map(createEvent)
    .filter(
      event =>
        event.date &&
        event.time &&
        event.channel &&
        event.location
    );

  const output = {
    source: "El Muletazo",
    fetchedAt: new Date().toISOString(),
    eventCount: events.length,
    events
  };

  await fs.mkdir(
    "data",
    {
      recursive: true
    }
  );

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `El Muletazo: ${events.length} eventos extraídos`
  );

  console.log(
    `Canal Extremadura: ${
      events.filter(
        event =>
          event.channel ===
          "Canal Extremadura"
      ).length
    } eventos extraídos`
  );
}

main().catch(
  error => {
    console.error(error);
    process.exit(1);
  }
);
