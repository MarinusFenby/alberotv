import fs from "node:fs/promises";
import crypto from "node:crypto";
import { chromium } from "playwright";

const SOURCE_URL =
  "https://www.mundotoro.com/carteles-taurinos";

const OUTPUT_FILE =
  "data/mundotoro.json";

const MONTHS = {
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


function normalizeSpaces(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeText(value = "") {
  return normalizeSpaces(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}


function slugId(value = "") {
  return crypto
    .createHash("sha1")
    .update(String(value))
    .digest("hex")
    .slice(0, 14);
}


function toIsoDate(day, month, year) {
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day)
    )
  );

  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}


function parseDateToken(value = "") {
  const text = normalizeSpaces(value);

  let match = text.match(
    /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/
  );

  if (match) {
    return toIsoDate(
      match[1],
      match[2],
      match[3]
    );
  }

  match = normalizeText(text).match(
    /\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})\b/
  );

  if (!match) return null;

  const month = MONTHS[match[2]];
  if (!month) return null;

  return toIsoDate(
    match[1],
    month,
    match[3]
  );
}


function extractTime(text = "") {
  const match = String(text).match(
    /\b([01]?\d|2[0-3])[:.](\d{2})\b/
  );

  if (!match) return null;

  return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}


function normalizeType(text = "") {
  const value = normalizeText(text);

  if (
    value.includes("rejones") ||
    value.includes("rejoneo")
  ) {
    return "Rejones";
  }

  if (
    value.includes("novillada") &&
    (
      value.includes("sin picadores") ||
      value.includes("sin caballos")
    )
  ) {
    return "Novillada sin picadores";
  }

  if (
    value.includes("novillada") &&
    (
      value.includes("con picadores") ||
      value.includes("picada")
    )
  ) {
    return "Novillada con picadores";
  }

  if (value.includes("novillada")) {
    return "Novillada";
  }

  // Muchos carteles omiten la palabra «novillada» y comienzan directamente
  // por «Novillos de…». No pueden caer en el valor genérico, porque la app
  // histórica interpretaba ese valor como corrida.
  if (/\b(?:erales?|becerros?)\s+de\b/.test(value)) {
    return "Novillada sin picadores";
  }

  if (/\b(?:novillos?|utreros?)\s+de\b/.test(value)) {
    return "Novillada";
  }

  if (
    value.includes("recortadores") ||
    value.includes("recortes")
  ) {
    return "Concurso de recortadores";
  }

  if (
    value.includes("corrida mixta") ||
    value.includes("festejo mixto")
  ) {
    return "Corrida mixta";
  }

  if (
    value.includes("corrida") ||
    /\btoros?\s+de\b/.test(value)
  ) {
    return "Corrida de toros";
  }

  return "Festejo taurino";
}


function cleanLocation(value = "") {
  return normalizeSpaces(
    String(value)
      .replace(
        /^\s*(?:\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2})\s*/i,
        ""
      )
      .replace(
        /^\s*(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s*/i,
        ""
      )
      .replace(
        /\s*\b(?:a las\s*)?(?:[01]?\d|2[0-3])[:.]\d{2}\s*(?:h(?:oras?)?)?\b/gi,
        " "
      )
      .replace(
        /\s*\(\s*(?:(?:plaza|coso)\s+(?:de\s+toros\s+)?)?port[aá]til\s*\)\s*/gi,
        " "
      )
      .replace(/\s*[-–—]\s*$/, "")
  );
}


function splitNames(value = "") {
  const cleaned = normalizeSpaces(
    String(value)
      .replace(/\.$/, "")
      .replace(
        /\b(?:mano a mano|en solitario)\b/gi,
        " "
      )
  );

  if (!cleaned) return [];

  return [
    ...new Set(
      cleaned
        .split(/\s*(?:,|;|·|\by\b)\s*/i)
        .map(normalizeSpaces)
        .filter(
          name =>
            name.length >= 3 &&
            !/^(?:toros?|novillos?|reses?|erales?)$/i.test(name)
        )
    )
  ];
}


function parseDescription(rawDescription = "") {
  let description = normalizeSpaces(rawDescription);

  description = description
    .replace(
      /\b(?:a las\s*)?(?:[01]?\d|2[0-3])[:.]\d{2}\s*(?:h(?:oras?)?)?\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  const type = normalizeType(description);

  let breeding = "";
  let participants = [];

  /*
   * Formatos habituales:
   * "Toros de Miura para A, B y C"
   * "Novillos de X para A, B y C"
   * "Reses de X para A, B y C"
   */
  const dePara = description.match(
    /(?:toros?|novillos?|reses?|erales?|utreros?)\s+de\s+(.+?)\s+para\s+(.+)$/i
  );

  if (dePara) {
    breeding = normalizeSpaces(dePara[1]);
    participants = splitNames(dePara[2]);
  } else {
    const para = description.match(
      /\bpara\s+(.+)$/i
    );

    if (para) {
      participants = splitNames(para[1]);

      const beforePara =
        description.slice(
          0,
          para.index
        );

      const breedingMatch =
        beforePara.match(
          /(?:de|ganader[ií]a\s*:?)\s+([^.;]+)$/i
        );

      if (breedingMatch) {
        breeding =
          normalizeSpaces(
            breedingMatch[1]
          );
      }
    }
  }

  breeding = breeding
    .replace(/^ganader[ií]a\s*:\s*/i, "")
    .trim();

  return {
    type,
    breeding,
    participants
  };
}


function splitDateBlocks(bodyText = "") {
  const text = String(bodyText)
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ");

  const datePattern =
    /\b\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}\b/g;

  const matches =
    [...text.matchAll(datePattern)];

  const blocks = [];

  for (
    let index = 0;
    index < matches.length;
    index += 1
  ) {
    const current = matches[index];
    const next = matches[index + 1];

    const date =
      parseDateToken(current[0]);

    if (!date) continue;

    const content =
      text.slice(
        current.index + current[0].length,
        next?.index ?? text.length
      );

    blocks.push({
      date,
      content
    });
  }

  return blocks;
}


function splitBlockEntries(content = "") {
  const normalized = String(content)
    .replace(/\r/g, "\n")
    .replace(/[•●]/g, "·")
    .replace(/\n{3,}/g, "\n\n");

  const lines = normalized
    .split(/\n+/)
    .map(normalizeSpaces)
    .filter(Boolean);

  /*
   * En algunas versiones de la página cada cartel aparece en una línea.
   * En otras, el separador visible es "·".
   */
  const entries = [];

  for (const line of lines) {
    const pieces = line
      .split(/\s+·\s+/)
      .map(normalizeSpaces)
      .filter(Boolean);

    entries.push(...pieces);
  }

  return entries;
}


function parseEntry(entry = "", date) {
  const text = normalizeSpaces(entry);

  if (
    !text ||
    text.length < 12 ||
    /carteles taurinos|publicidad|newsletter|suscr[ií]bete|mundotoro/i.test(text)
  ) {
    return null;
  }

  /*
   * La separación estable de Mundotoro es:
   * "Localidad País - descripción del cartel"
   */
  const separator =
    text.search(/\s[-–—]\s/);

  if (separator < 0) {
    return null;
  }

  const left =
    text.slice(0, separator);

  const right =
    text.slice(separator)
      .replace(/^\s*[-–—]\s*/, "");

  const location =
    cleanLocation(left);

  if (
    !location ||
    location.length > 150 ||
    right.length < 8
  ) {
    return null;
  }

  const time =
    extractTime(text);

  const details =
    parseDescription(right);

  const event = {
    id:
      `mundotoro-${slugId(
        [
          date,
          time || "",
          location,
          details.type,
          details.breeding,
          details.participants.join("|")
        ].join("::")
      )}`,
    date,
    time,
    channel: "Sin TV",
    televised: false,
    location,
    type: details.type,
    contentType: "festejo",
    breeding: details.breeding,
    participants: details.participants,
    name: location,
    title: null,
    image: null,
    eventUrl: SOURCE_URL,
    sourceUrl: SOURCE_URL
  };

  return event;
}


function deduplicateEvents(events = []) {
  const unique = new Map();

  for (const event of events) {
    const key = [
      event.date,
      event.time || "",
      normalizeText(event.location),
      normalizeText(event.type),
      normalizeText(event.breeding),
      event.participants
        .map(normalizeText)
        .join("|")
    ].join("::");

    if (!unique.has(key)) {
      unique.set(key, event);
    }
  }

  return [...unique.values()];
}


async function extractBodyText(page) {
  await page.goto(
    SOURCE_URL,
    {
      waitUntil: "domcontentloaded",
      timeout: 60000
    }
  );

  await page.waitForTimeout(3500);

  return await page.locator("body").innerText({
    timeout: 30000
  });
}


async function main() {
  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    const context =
      await browser.newContext({
        locale: "es-ES",
        timezoneId: "Europe/Madrid",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/126.0.0.0 Safari/537.36"
      });

    const page =
      await context.newPage();

    const bodyText =
      await extractBodyText(page);

    const blocks =
      splitDateBlocks(bodyText);

    const events = [];

    for (const block of blocks) {
      for (
        const entry
        of splitBlockEntries(block.content)
      ) {
        const parsed =
          parseEntry(
            entry,
            block.date
          );

        if (parsed) {
          events.push(parsed);
        }
      }
    }

    const deduplicated =
      deduplicateEvents(events)
        .sort((first, second) => {
          const dateComparison =
            first.date.localeCompare(
              second.date
            );

          if (dateComparison !== 0) {
            return dateComparison;
          }

          return String(
            first.time || "99:99"
          ).localeCompare(
            String(
              second.time || "99:99"
            )
          );
        });

    if (deduplicated.length === 0) {
      throw new Error(
        "Mundotoro no produjo eventos. " +
        "La estructura de la página puede haber cambiado."
      );
    }

    const output = {
      fetchedAt:
        new Date().toISOString(),

      source:
        "Mundotoro",

      sourceUrl:
        SOURCE_URL,

      eventCount:
        deduplicated.length,

      events:
        deduplicated
    };

    await fs.mkdir(
      "data",
      {
        recursive: true
      }
    );

    await fs.writeFile(
      OUTPUT_FILE,
      JSON.stringify(
        output,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(
      `Mundotoro: ${deduplicated.length} festejos no televisados`
    );
  } finally {
    await browser.close();
  }
}


main().catch(error => {
  console.error(
    "Error en Mundotoro:",
    error
  );

  process.exitCode = 1;
});
