
const timeline = document.getElementById("timeline");
const hint = document.getElementById("hint");
const categoryList = document.getElementById("category-list");

const months = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre"
];

const weekdays = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado"
];

let cards = [];
let activeCard = null;
let activeIndex = 0;
let previousActiveCard = null;

let isDragging = false;
let dragStartX = 0;
let dragStartScrollLeft = 0;
let dragMoved = false;

let animationFrameRequested = false;
let loadedEvents = [];
let eventStatusTimer = null;


/* ==================================================
   UTILIDADES
   ================================================== */

function toLocalISO(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}


function getDayLabel(offset) {
  if (offset === -1) {
    return "AYER";
  }

  if (offset === 0) {
    return "HOY";
  }

  if (offset === 1) {
    return "MAÑANA";
  }

  return "";
}


function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function formatParticipants(participants = []) {
  return participants
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
}


function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}


function decodeBasicHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&iacute;|&#237;|&#x0*ed;/gi, "í")
    .replace(/&Iacute;|&#205;|&#x0*cd;/gi, "Í")
    .replace(/&(?:laquo|raquo|ldquo|rdquo|quot);/gi, " ")
    .replace(/&amp;/gi, "&");
}


function cleanBreedingDisplay(value = "") {
  let cleaned = decodeBasicHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[«»“”"'´`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Elimina tantos prefijos iniciales como existan:
   * Ganadería: Miura
   * Ganadería: Ganadería: Miura
   * «Ganadería: Ganadería: Miura»
   */
  const prefixPattern =
    /^\s*ganader(?:í|i)a\s*(?::|\-|–|—)?\s*/i;

  while (prefixPattern.test(cleaned)) {
    cleaned = cleaned
      .replace(prefixPattern, "")
      .replace(/^[\s:–—-]+/, "")
      .trim();
  }

  return cleaned;
}


function canonicalEventLocation(value = "") {
  const text = normalizeText(value)
    .replace(/\bespana\b/g, " ")
    .replace(/\bplaza de toros\b/g, " ")
    .replace(/\bmonumental\b/g, " ")
    .replace(/\breal maestranza\b/g, " maestranza ")
    .replace(/\blas ventas\b/g, " madrid ")
    .replace(/[()[\],.;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases = [
    ["madrid", "madrid"],
    ["pamplona", "pamplona"],
    ["azpeitia", "azpeitia"],
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
    ["arles", "arles"]
  ];

  for (const [needle, canonical] of aliases) {
    if (text.includes(needle)) {
      return canonical;
    }
  }

  return text;
}


function participantOverlapRatio(first = [], second = []) {
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


function stringSimilarity(first = "", second = "") {
  const a = normalizeText(first);
  const b = normalizeText(second);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    return 0.92;
  }

  const firstTokens = new Set(a.split(/\s+/).filter(Boolean));
  const secondTokens = new Set(b.split(/\s+/).filter(Boolean));

  if (!firstTokens.size || !secondTokens.size) {
    return 0;
  }

  let matches = 0;

  for (const token of firstTokens) {
    if (secondTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / Math.max(
    firstTokens.size,
    secondTokens.size
  );
}


function isRealTelevisedChannel(channel = "") {
  const normalized = normalizeText(channel);

  return Boolean(
    normalized &&
    ![
      "sin tv",
      "no tv",
      "no televisado",
      "no televisada",
      "sin television",
      "sin televisión"
    ].includes(normalized)
  );
}


function areSameBullfightingEvent(first = {}, second = {}) {
  if (isProgram(first) || isProgram(second)) {
    return false;
  }

  if (
    !first.date ||
    !second.date ||
    first.date !== second.date
  ) {
    return false;
  }

  const firstLocation = canonicalEventLocation(
    first.location || first.name || first.title || ""
  );

  const secondLocation = canonicalEventLocation(
    second.location || second.name || second.title || ""
  );

  if (
    !firstLocation ||
    !secondLocation ||
    firstLocation !== secondLocation
  ) {
    return false;
  }

  const sameType =
    normalizeText(first.type) === normalizeText(second.type);

  if (!sameType) {
    return false;
  }

  const participantsOverlap =
    participantOverlapRatio(
      first.participants,
      second.participants
    );

  const breedingSimilarity =
    stringSimilarity(
      cleanBreedingDisplay(first.breeding),
      cleanBreedingDisplay(second.breeding)
    );

  return (
    participantsOverlap >= 0.5 ||
    breedingSimilarity >= 0.72
  );
}


function chooseMoreInformativeLocation(first = "", second = "") {
  const a = String(first || "").trim();
  const b = String(second || "").trim();

  if (!a) return b;
  if (!b) return a;

  const score = value => {
    let total = value.length;

    if (/plaza de toros/i.test(value)) total += 30;
    if (/monumental/i.test(value)) total += 20;
    if (/\(/.test(value)) total += 10;
    if (/españa/i.test(value)) total -= 8;

    return total;
  };

  return score(a) >= score(b)
    ? a
    : b;
}


function mergeDuplicateDisplayEvents(first = {}, second = {}) {
  const televisedFirst =
    !isNonTelevisedEvent(first);

  const televisedSecond =
    !isNonTelevisedEvent(second);

  const preferred =
    televisedFirst && !televisedSecond
      ? first
      : (
          televisedSecond && !televisedFirst
            ? second
            : first
        );

  const secondary =
    preferred === first
      ? second
      : first;

  const mergedSources = [
    ...new Set(
      [
        ...(Array.isArray(first.sources) ? first.sources : [first.source].filter(Boolean)),
        ...(Array.isArray(second.sources) ? second.sources : [second.source].filter(Boolean))
      ].filter(Boolean)
    )
  ];

  const realChannel =
    isRealTelevisedChannel(first.channel)
      ? first.channel
      : (
          isRealTelevisedChannel(second.channel)
            ? second.channel
            : (preferred.channel || secondary.channel || null)
        );

  return {
    ...secondary,
    ...preferred,
    location: chooseMoreInformativeLocation(
      first.location,
      second.location
    ),
    title: chooseMoreInformativeLocation(
      first.title,
      second.title
    ),
    name: chooseMoreInformativeLocation(
      first.name,
      second.name
    ),
    breeding: cleanBreedingDisplay(
      preferred.breeding || secondary.breeding || ""
    ),
    participants:
      (preferred.participants && preferred.participants.length)
        ? preferred.participants
        : (secondary.participants || []),
    time:
      preferred.time || secondary.time || "",
    channel: realChannel,
    televised:
      televisedFirst || televisedSecond,
    sources: mergedSources
  };
}


function deduplicateDisplayEvents(events = []) {
  const deduplicated = [];

  for (const event of events) {
    const current = {
      ...event,
      breeding: cleanBreedingDisplay(event.breeding || "")
    };

    const existingIndex =
      deduplicated.findIndex(existing =>
        areSameBullfightingEvent(existing, current)
      );

    if (existingIndex >= 0) {
      deduplicated[existingIndex] =
        mergeDuplicateDisplayEvents(
          deduplicated[existingIndex],
          current
        );

      continue;
    }

    deduplicated.push(current);
  }

  return deduplicated;
}

function isProgram(event = {}) {
  return (
    normalizeText(event.contentType) === "programa" ||
    normalizeText(event.type).includes("programa taurino")
  );
}


/* ==================================================
   HORARIO LOCAL DEL USUARIO
   Origen de las emisiones: Europe/Madrid
   ================================================== */

const SOURCE_TIME_ZONE = "Europe/Madrid";
const USER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function hasValidEventTime(event = {}) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || "")) && /^\d{1,2}:\d{2}$/.test(String(event.time || ""));
}

function getTimeZoneOffsetMilliseconds(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = {};
  parts.forEach(part => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - date.getTime();
}

function madridDateTimeToUtc(dateKey, timeValue) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const initialGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  let utcMilliseconds = initialGuess.getTime();
  for (let attempt = 0; attempt < 3; attempt++) {
    const offset = getTimeZoneOffsetMilliseconds(new Date(utcMilliseconds), SOURCE_TIME_ZONE);
    const corrected = initialGuess.getTime() - offset;
    if (Math.abs(corrected - utcMilliseconds) < 1000) {
      utcMilliseconds = corrected;
      break;
    }
    utcMilliseconds = corrected;
  }
  return new Date(utcMilliseconds);
}

function getDatePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = {};
  parts.forEach(part => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return `${values.year}-${values.month}-${values.day}`;
}

function getDayDifferenceLabel(sourceDateKey, localDateKey) {
  const sourceDate = new Date(`${sourceDateKey}T00:00:00Z`);
  const localDate = new Date(`${localDateKey}T00:00:00Z`);
  const difference = Math.round((localDate.getTime() - sourceDate.getTime()) / 86400000);
  if (difference === 1) return "+1 día";
  if (difference === -1) return "−1 día";
  if (difference > 1) return `+${difference} días`;
  if (difference < -1) return `−${Math.abs(difference)} días`;
  return "";
}

function getEventTimePresentation(event = {}) {
  if (!hasValidEventTime(event)) {
    return { main: event.time || "Hora por confirmar", original: "", dayShift: "", title: "" };
  }
  const instant = madridDateTimeToUtc(event.date, event.time);
  const localTime = new Intl.DateTimeFormat("es-ES", {
    timeZone: USER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(instant);
  const localDateKey = getDatePartsInTimeZone(instant, USER_TIME_ZONE);
  const dayShift = getDayDifferenceLabel(event.date, localDateKey);
  const zoneName = new Intl.DateTimeFormat("es-ES", {
    timeZone: USER_TIME_ZONE,
    timeZoneName: "long"
  }).formatToParts(instant).find(part => part.type === "timeZoneName")?.value || USER_TIME_ZONE;
  return {
    main: localTime,
    original: event.time,
    dayShift,
    title: `Hora local: ${localTime}${dayShift ? ` (${dayShift})` : ""}. Hora en España: ${event.time}. ${zoneName}.`
  };
}

function buildTimeMarkup(event = {}) {
  const presentation = getEventTimePresentation(event);
  if (!presentation.original) {
    return `<div class="time">${escapeHtml(presentation.main)}</div>`;
  }
  return `
    <div class="time time-local" title="${escapeHtml(presentation.title)}" tabindex="0" aria-label="${escapeHtml(presentation.title)}">
      <span class="time-main">${escapeHtml(presentation.main)}</span>
      ${presentation.dayShift ? `<span class="time-day-shift">${escapeHtml(presentation.dayShift)}</span>` : ""}
      <span class="time-origin">España: ${escapeHtml(presentation.original)}</span>
    </div>
  `;
}


/* ==================================================
   CUENTA ATRÁS, CONTEXTO DEL DÍA Y ESTADO DE EMISIÓN
   ================================================== */

function getEstimatedDurationMinutes(event = {}) {
  if (Number(event.durationMinutes) > 0) {
    return Number(event.durationMinutes);
  }

  if (isProgram(event)) {
    return 60;
  }

  const type = normalizeText(event.type);

  if (
    type.includes("recortes") ||
    type.includes("recortadores")
  ) {
    return 120;
  }

  if (
    type.includes("tentadero") ||
    type.includes("tienta") ||
    type.includes("clase practica")
  ) {
    return 90;
  }

  return 150;
}


function getEventStartInstant(event = {}) {
  if (!hasValidEventTime(event)) {
    return null;
  }

  return madridDateTimeToUtc(
    event.date,
    event.time
  );
}


function getLocalCalendarDifference(startInstant, now = new Date()) {
  const startDateKey =
    getDatePartsInTimeZone(
      startInstant,
      USER_TIME_ZONE
    );

  const todayDateKey =
    getDatePartsInTimeZone(
      now,
      USER_TIME_ZONE
    );

  const startDate =
    new Date(
      `${startDateKey}T00:00:00Z`
    );

  const todayDate =
    new Date(
      `${todayDateKey}T00:00:00Z`
    );

  return Math.round(
    (
      startDate.getTime() -
      todayDate.getTime()
    ) /
    86400000
  );
}


function getRemainingTimeParts(totalMinutes) {
  const safeMinutes =
    Math.max(
      0,
      Math.ceil(totalMinutes)
    );

  const days =
    Math.floor(
      safeMinutes /
      1440
    );

  const hours =
    Math.floor(
      (
        safeMinutes %
        1440
      ) /
      60
    );

  const minutes =
    safeMinutes %
    60;

  return {
    days,
    hours,
    minutes
  };
}


function pluralize(value, singular, plural) {
  return value === 1
    ? singular
    : plural;
}


function buildLongRemainingLabel(parts) {
  const chunks = [];

  if (parts.days > 0) {
    chunks.push(
      `${parts.days} ${pluralize(parts.days, "día", "días")}`
    );
  }

  if (parts.hours > 0) {
    chunks.push(
      `${parts.hours} h`
    );
  }

  if (
    parts.days === 0 &&
    parts.minutes > 0
  ) {
    chunks.push(
      `${parts.minutes} min`
    );
  }

  if (
    parts.days > 0 &&
    parts.hours === 0 &&
    parts.minutes > 0
  ) {
    chunks.push(
      `${parts.minutes} min`
    );
  }

  return chunks.join(" ");
}


function buildUpcomingStatusLabel(startInstant, minutesUntilStart) {
  const parts =
    getRemainingTimeParts(
      minutesUntilStart
    );

  const calendarDifference =
    getLocalCalendarDifference(
      startInstant
    );

  if (minutesUntilStart <= 15) {
    return {
      key: "starting-soon",
      label: `COMIENZA EN ${Math.max(1, parts.minutes)} MIN`
    };
  }

  if (calendarDifference === 0) {
    return {
      key: "today",
      label: `HOY · ${buildLongRemainingLabel(parts).toUpperCase()}`
    };
  }

  if (calendarDifference === 1) {
    return {
      key: "tomorrow",
      label: `MAÑANA · ${buildLongRemainingLabel(parts).toUpperCase()}`
    };
  }

  if (calendarDifference > 1) {
    const residualParts = {
      days: 0,
      hours: parts.hours,
      minutes:
        parts.hours === 0
          ? parts.minutes
          : 0
    };

    const residualLabel =
      buildLongRemainingLabel(
        residualParts
      );

    return {
      key: "future",
      label:
        residualLabel
          ? `EN ${calendarDifference} DÍAS · ${residualLabel.toUpperCase()}`
          : `EN ${calendarDifference} DÍAS`
    };
  }

  return {
    key: "upcoming",
    label: `EMPIEZA EN ${buildLongRemainingLabel(parts).toUpperCase()}`
  };
}


function getTemporalStatus(event = {}, now = new Date()) {
  const startInstant =
    getEventStartInstant(event);

  if (!startInstant) {
    return null;
  }

  const durationMinutes =
    getEstimatedDurationMinutes(event);

  const endInstant =
    new Date(
      startInstant.getTime() +
      durationMinutes * 60000
    );

  const millisecondsUntilStart =
    startInstant.getTime() -
    now.getTime();

  if (millisecondsUntilStart > 0) {
    return buildUpcomingStatusLabel(
      startInstant,
      millisecondsUntilStart /
      60000
    );
  }

  if (
    now.getTime() <
    endInstant.getTime()
  ) {
    return {
      key: "live",
      label: "EN DIRECTO"
    };
  }

  return {
    key: "finished",
    label: "FINALIZADO"
  };
}


function buildTemporalStatusMarkup(event = {}) {
  const status =
    getTemporalStatus(event);

  const startInstant =
    getEventStartInstant(event);

  if (!status || !startInstant) {
    return "";
  }

  return `
    <div
      class="event-status event-status-${status.key}"
      data-event-start="${escapeHtml(startInstant.toISOString())}"
      data-event-duration="${escapeHtml(getEstimatedDurationMinutes(event))}"
      role="status"
      aria-live="polite"
    >
      <span class="event-status-light" aria-hidden="true"></span>
      <span class="event-status-text">${escapeHtml(status.label)}</span>
    </div>
  `;
}


function getStatusFromStoredElement(element, now = new Date()) {
  const startInstant =
    new Date(
      element.dataset.eventStart
    );

  const durationMinutes =
    Number(
      element.dataset.eventDuration
    );

  if (
    Number.isNaN(startInstant.getTime()) ||
    !Number.isFinite(durationMinutes)
  ) {
    return null;
  }

  const endInstant =
    new Date(
      startInstant.getTime() +
      durationMinutes * 60000
    );

  const millisecondsUntilStart =
    startInstant.getTime() -
    now.getTime();

  if (millisecondsUntilStart > 0) {
    return buildUpcomingStatusLabel(
      startInstant,
      millisecondsUntilStart /
      60000
    );
  }

  if (
    now.getTime() <
    endInstant.getTime()
  ) {
    return {
      key: "live",
      label: "EN DIRECTO"
    };
  }

  return {
    key: "finished",
    label: "FINALIZADO"
  };
}


function updateTemporalStatuses() {
  const now =
    new Date();

  document
    .querySelectorAll(".event-status")
    .forEach(element => {
      const status =
        getStatusFromStoredElement(
          element,
          now
        );

      if (!status) {
        return;
      }

      element.className =
        `event-status event-status-${status.key}`;

      const text =
        element.querySelector(
          ".event-status-text"
        );

      if (text) {
        text.textContent =
          status.label;
      }
    });
}


function startTemporalStatusUpdates() {
  if (eventStatusTimer) {
    clearInterval(
      eventStatusTimer
    );
  }

  updateTemporalStatuses();

  eventStatusTimer =
    setInterval(
      updateTemporalStatuses,
      30000
    );
}


function getBroadcastPresentation(event = {}) {
  const rawChannel =
    String(
      event.channel ||
      event.broadcastChannel ||
      event.source ||
      ""
    ).trim();

  const normalizedChannel =
    normalizeText(rawChannel);

  const confirmedByFlag =
    event.televised === true ||
    event.isTelevised === true ||
    event.broadcastConfirmed === true;

  const explicitlyUnconfirmed =
    event.televised === false ||
    event.isTelevised === false ||
    event.broadcastConfirmed === false;

  const genericValues = [
    "",
    "canal por confirmar",
    "por confirmar",
    "sin confirmar",
    "no confirmado",
    "ninguno"
  ];

  const hasNamedChannel =
    !genericValues.includes(
      normalizedChannel
    );

  if (
    explicitlyUnconfirmed ||
    (!confirmedByFlag && !hasNamedChannel)
  ) {
    return {
      confirmed: false,
      label: "Sin emisión confirmada",
      normalizedChannel: ""
    };
  }

  return {
    confirmed: true,
    label: rawChannel || "Emisión confirmada",
    normalizedChannel
  };
}


const CHANNEL_LOGOS = [
  {
    matches: ["onetoro", "one toro"],
    src: "assets/channels/onetoro.png",
    alt: "OneToro"
  },
  {
    matches: ["canal sur", "canal sur 1", "canal sur andalucia"],
    src: "assets/channels/canal-sur.png",
    alt: "Canal Sur"
  },
  {
    matches: ["cmm", "castilla-la mancha", "castilla la mancha", "castilla de mancha"],
    src: "assets/channels/cmm.png",
    alt: "Castilla-La Mancha Media"
  },
  {
    matches: ["telemadrid", "tele madrid"],
    src: "assets/channels/telemadrid.png",
    alt: "Telemadrid"
  },
  {
    matches: ["aragon tv", "aragón tv", "atv"],
    src: "assets/channels/aragon-tv.png",
    alt: "Aragón TV"
  },
  {
    matches: ["la 1", "tve 1", "tve1"],
    src: "assets/channels/tve-1.png",
    alt: "La 1"
  },
  {
    matches: ["la 2", "tve 2", "tve2"],
    src: "assets/channels/tve-2.png",
    alt: "La 2"
  }
];


function getChannelLogoData(channelName = "") {
  const normalized =
    normalizeText(channelName);

  return CHANNEL_LOGOS.find(channel =>
    channel.matches.some(match =>
      normalized === normalizeText(match) ||
      normalized.includes(normalizeText(match))
    )
  ) || null;
}


function getChannelInitials(channelName = "") {
  const words =
    String(channelName)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return "TV";
  }

  if (words.length === 1) {
    return words[0]
      .slice(0, 3)
      .toUpperCase();
  }

  return words
    .slice(0, 3)
    .map(word => word[0])
    .join("")
    .toUpperCase();
}


function getLocationLengthClass(location = "") {
  const length = String(location).trim().length;

  if (length >= 42) {
    return "location-xlong";
  }

  if (length >= 28) {
    return "location-long";
  }

  if (length >= 18) {
    return "location-medium";
  }

  return "location-short";
}



const COUNTRY_PRESENTATIONS = {
  ES: { name: "España", className: "country-es" },
  FR: { name: "Francia", className: "country-fr" },
  PT: { name: "Portugal", className: "country-pt" },
  MX: { name: "México", className: "country-mx" },
  CO: { name: "Colombia", className: "country-co" },
  PE: { name: "Perú", className: "country-pe" },
  EC: { name: "Ecuador", className: "country-ec" }
};


function getEventCountryCode(event = {}) {
  const explicitCode =
    String(
      event.countryCode ||
      event.country_code ||
      ""
    )
      .trim()
      .toUpperCase();

  if (COUNTRY_PRESENTATIONS[explicitCode]) {
    return explicitCode;
  }

  const searchableText =
    normalizeText(
      [
        event.country,
        event.location,
        event.name,
        event.title
      ]
        .filter(Boolean)
        .join(" ")
    );

  const countryRules = [
    {
      code: "FR",
      terms: [
        "francia", "france", "nimes", "arles", "beziers",
        "dax", "bayona", "bayonne", "mont de marsan",
        "vic fezensac"
      ]
    },
    {
      code: "PT",
      terms: [
        "portugal", "lisboa", "santarem", "vilafranca de xira",
        "vila franca de xira", "campo pequeno", "moita"
      ]
    },
    {
      code: "MX",
      terms: [
        "mexico", "aguascalientes", "guadalajara",
        "queretaro", "tlaxcala", "zacatecas"
      ]
    },
    {
      code: "CO",
      terms: [
        "colombia", "bogota", "cali", "manizales", "medellin"
      ]
    },
    {
      code: "PE",
      terms: [
        "peru", "lima", "acho", "cajabamba"
      ]
    },
    {
      code: "EC",
      terms: [
        "ecuador", "quito", "riobamba", "latacunga"
      ]
    },
    {
      code: "ES",
      terms: [
        "espana"
      ]
    }
  ];

  for (const rule of countryRules) {
    if (
      rule.terms.some(term =>
        searchableText.includes(
          normalizeText(term)
        )
      )
    ) {
      return rule.code;
    }
  }

  return "ES";
}


function buildCountryCornerMarkup(event = {}) {
  const countryCode =
    getEventCountryCode(event);

  const presentation =
    COUNTRY_PRESENTATIONS[countryCode];

  if (!presentation) {
    return "";
  }

  return `
    <span
      class="country-corner ${presentation.className}"
      title="${escapeHtml(presentation.name)}"
      aria-label="Evento en ${escapeHtml(presentation.name)}"
    ></span>
  `;
}


function getEventAccentClass(event = {}) {
  return getTypeClass(event.type || "");
}


function buildPersonIconMarkup(event = {}) {
  const type = normalizeText(event.type);

  if (
    type.includes("rejones") ||
    type.includes("rejoneo") ||
    type.includes("rejoneadores")
  ) {
    return `
      <span
        class="event-detail-icon person-detail-icon event-icon-rejones"
        aria-hidden="true"
      >
        <svg viewBox="0 0 36 36" focusable="false">
          <circle cx="21.5" cy="7" r="2.4"></circle>
          <path d="m20 10-5.2 5.2 3.2 2.7 5-4.2 2.4-4.5"></path>
          <path d="M5 25c3.2-6.2 8.3-9.3 14.8-9.3 5.4 0 9.5 2.1 12.2 6.5-4.3-.8-8-.5-11.1 1-4.6 2.1-9.9 2.7-15.9 1.8Z"></path>
          <path d="m9.2 24.3-1.6 7"></path>
          <path d="m25.2 23.4 2 7.9"></path>
          <path d="m25.5 10.2 5.8-7"></path>
        </svg>
      </span>
    `;
  }

  if (
    type.includes("recortes") ||
    type.includes("recortadores") ||
    type.includes("concurso de recortes")
  ) {
    return `
      <span
        class="event-detail-icon person-detail-icon event-icon-recortes"
        aria-hidden="true"
      >
        <svg viewBox="0 0 36 36" focusable="false">
          <circle cx="23" cy="6.2" r="2.5"></circle>
          <path d="m21 9-6.5 6.3 4.4 3.8 6.1-4.4"></path>
          <path d="m14.5 15.3-7.8 2.5"></path>
          <path d="m18.9 19.1-3.6 10.7"></path>
          <path d="m25 14.7 5.8 7.4"></path>
        </svg>
      </span>
    `;
  }

  return `
    <span
      class="event-detail-icon person-detail-icon event-icon-torero"
      aria-hidden="true"
    >
      <svg viewBox="0 0 36 36" focusable="false">
        <path d="M9.2 8.7C11.6 5.9 14.5 4.5 18 4.5s6.4 1.4 8.8 4.2"></path>
        <path d="M6.5 9.3c3.5 1.4 7.3 2.1 11.5 2.1s8-.7 11.5-2.1"></path>
        <path d="M11.8 11.2v2.4c0 3.8 2.7 6.7 6.2 6.7s6.2-2.9 6.2-6.7v-2.4"></path>
        <path d="M10.5 20.5c-4 2.2-6.1 5.9-6.5 11h28c-.4-5.1-2.5-8.8-6.5-11L18 25.7Z"></path>
        <path d="M18 25.7v5.8"></path>
        <path d="M12.8 23.2 18 27l5.2-3.8"></path>
      </svg>
    </span>
  `;
}


function buildBreedingIconMarkup(event = {}) {
  return `
    <span
      class="event-detail-icon breeding-detail-icon event-icon-bull"
      aria-hidden="true"
    >
      <svg viewBox="0 0 36 36" focusable="false">
        <path d="M11.3 11.2C7.7 11 4.5 8.9 2.8 5.5c4.4-.2 7.7 1.2 9.7 4"></path>
        <path d="M24.7 11.2c3.6-.2 6.8-2.3 8.5-5.7-4.4-.2-7.7 1.2-9.7 4"></path>
        <path d="M11.8 10.9c1.8-3.1 3.9-4.6 6.2-4.6s4.4 1.5 6.2 4.6c1.5 2.6 1.9 5.5 1 8.6-1.2 4.6-4 7.9-7.2 7.9s-6-3.3-7.2-7.9c-.9-3.1-.5-6 1-8.6Z"></path>
        <path d="M13.8 15.8c1.2-.9 2.6-1.4 4.2-1.4s3 .5 4.2 1.4"></path>
        <circle cx="15.1" cy="18.1" r=".75"></circle>
        <circle cx="20.9" cy="18.1" r=".75"></circle>
        <path d="M15 22.1c1.8 1.4 4.2 1.4 6 0"></path>
      </svg>
    </span>
  `;
}

function getChannelLogoMarkup(channelName = "") {
  const logo =
    getChannelLogoData(channelName);

  if (logo) {
    return `
      <div class="channel-identity">
        <span
        class="channel-logo-circle"
        title="${escapeHtml(logo.alt)}"
        aria-label="${escapeHtml(logo.alt)}"
      >
        <img
          src="${escapeHtml(logo.src)}"
          alt="${escapeHtml(logo.alt)}"
          loading="lazy"
          onerror="this.closest('.channel-logo-circle').classList.add('logo-missing'); this.remove();"
        >
        <span class="channel-logo-fallback" aria-hidden="true">
          ${escapeHtml(getChannelInitials(logo.alt))}
        </span>
      </span>
      <span class="channel-name">${escapeHtml(logo.alt)}</span>
      </div>
    `;
  }

  return `
    <div class="channel-identity">
      <span
        class="channel-logo-circle channel-logo-generic"
        title="${escapeHtml(channelName)}"
        aria-label="${escapeHtml(channelName)}"
      >
        <span class="channel-logo-fallback">
          ${escapeHtml(getChannelInitials(channelName))}
        </span>
      </span>
      <span class="channel-name">
        ${escapeHtml(channelName)}
      </span>
    </div>
  `;
}


function isNonTelevisedEvent(event = {}) {
  if (event.televised === false) {
    return true;
  }

  const channel = normalizeText(
    event.channel || ""
  );

  const sources = Array.isArray(event.sources)
    ? event.sources.map(normalizeText)
    : [];

  const hasRealChannel =
    channel &&
    ![
      "sin tv",
      "no tv",
      "no televisado",
      "no televisada",
      "sin television"
    ].includes(channel);

  if (hasRealChannel) {
    return false;
  }

  return (
    !channel ||
    channel === "sin tv" ||
    channel === "no tv" ||
    channel === "no televisado" ||
    channel === "no televisada" ||
    channel === "sin television" ||
    sources.includes("mundotoro")
  );
}


function buildBroadcastMarkup(event = {}) {
  if (isNonTelevisedEvent(event)) {
    return `
      <div
        class="non-tv-badge"
        aria-label="No televisado"
      >
        SIN TV
      </div>
    `;
  }

  const broadcast =
    getBroadcastPresentation(event);

  if (!broadcast.confirmed) {
    return `
      <div
        class="channel-logo-circle channel-logo-unconfirmed"
        title="Sin emisión confirmada"
        aria-label="Sin emisión confirmada"
      >
        <span aria-hidden="true">?</span>
      </div>
    `;
  }

  return getChannelLogoMarkup(
    broadcast.label
  );
}

function buildEventHeaderMarkup(event = {}) {
  const nonTelevised =
    isNonTelevisedEvent(event);

  const hasTime =
    hasValidEventTime(event);

  const broadcast =
    getBroadcastPresentation(event);

  if (
    nonTelevised &&
    !hasTime
  ) {
    return `
      <div
        class="event-compact-header non-tv-without-time"
      >
        <div class="event-header-information">
          <div class="non-tv-badge-left">
            ${buildBroadcastMarkup(event)}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="event-compact-header">
      <div class="event-header-information">
        <div class="event-topline">
          ${buildTimeMarkup(event)}
        </div>

        ${buildTemporalStatusMarkup(event)}

        ${
          !nonTelevised &&
          !broadcast.confirmed
            ? `
              <div class="broadcast-unconfirmed-label">
                Sin emisión confirmada
              </div>
            `
            : ""
        }
      </div>

      <div class="event-header-channel">
        ${buildBroadcastMarkup(event)}
      </div>
    </div>
  `;
}

function scrollToToday(options = {}) {
  const {
    behavior = "smooth",
    resetVertical = true
  } = options;

  const todayCard =
    document.querySelector(
      '.day[data-offset="0"]'
    );

  if (!todayCard || !timeline) {
    return;
  }

  const targetLeft =
    todayCard.offsetLeft -
    timeline.clientWidth / 2 +
    todayCard.offsetWidth / 2;

  if (behavior === "auto") {
    timeline.scrollLeft =
      targetLeft;
  } else {
    timeline.scrollTo({
      left: targetLeft,
      behavior
    });
  }

  if (resetVertical) {
    const eventsContainer =
      todayCard.querySelector(
        ".events"
      );

    if (eventsContainer) {
      if (behavior === "auto") {
        eventsContainer.scrollTop = 0;
      } else {
        eventsContainer.scrollTo({
          top: 0,
          behavior
        });
      }
    }
  }
}


function forceTodayOnOpen() {
  /*
   * iOS puede restaurar la posición horizontal anterior
   * al abrir un acceso de la pantalla de inicio.
   * Recentramos HOY varias veces para imponernos a esa restauración.
   */
  const delays = [
    0,
    120,
    450
  ];

  delays.forEach(delay => {
    window.setTimeout(() => {
      scrollToToday({
        behavior: "auto",
        resetVertical: true
      });

      updateVisuals();
    }, delay);
  });
}


function ensureTopbarActionsRow() {
  let row =
    document.getElementById(
      "topbar-actions-row"
    );

  if (row) {
    return row;
  }

  const topbarInner =
    document.querySelector(
      ".topbar .topbar-inner"
    ) ||
    document.querySelector(
      ".topbar"
    );

  if (!topbarInner) {
    return null;
  }

  row =
    document.createElement("div");

  row.id =
    "topbar-actions-row";

  row.className =
    "topbar-actions-row";

  const categoryNav =
    topbarInner.querySelector(
      ".category-nav"
    );

  if (categoryNav) {
    topbarInner.insertBefore(
      row,
      categoryNav
    );
  } else {
    topbarInner.appendChild(
      row
    );
  }

  return row;
}



/* ==================================================
   EXPLORAR POR UBICACIÓN
   ================================================== */

function ensureLocationExplorerButton() {
  let button =
    document.getElementById(
      "location-explorer-button"
    );

  if (button) {
    return button;
  }

  const actionsRow =
    ensureTopbarActionsRow();

  if (!actionsRow) {
    return null;
  }

  button =
    document.createElement("button");

  button.id =
    "location-explorer-button";

  button.className =
    "location-explorer-button";

  button.type =
    "button";

  button.setAttribute(
    "aria-label",
    "Buscar festejos por ubicación"
  );

  button.innerHTML = `
    <span aria-hidden="true">📍</span>
  `;

  actionsRow.prepend(button);

  return button;
}


function ensureLocationExplorerSheet() {
  let sheet =
    document.getElementById(
      "location-explorer-sheet"
    );

  if (sheet) {
    return sheet;
  }

  sheet =
    document.createElement("div");

  sheet.id =
    "location-explorer-sheet";

  sheet.className =
    "location-explorer-sheet";

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  sheet.innerHTML = `
    <div
      class="location-explorer-backdrop"
      data-close-location-explorer
    ></div>

    <section
      class="location-explorer-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-explorer-title"
    >
      <div class="location-explorer-handle"></div>

      <h2 id="location-explorer-title">
        Explorar por ubicación
      </h2>

      <p class="location-explorer-description">
        Busca festejos cerca de ti o alrededor
        de una ciudad que vayas a visitar.
      </p>

      <button
        type="button"
        class="location-current-button"
        data-use-current-location
      >
        📍 Usar mi ubicación
      </button>

      <div class="location-divider">
        <span>o buscar una ciudad</span>
      </div>

      <form
        class="location-city-form"
        id="location-city-form"
      >
        <input
          id="location-city-input"
          type="search"
          placeholder="Ejemplo: Alicante"
          autocomplete="off"
          required
        >

        <button type="submit">
          Buscar
        </button>
      </form>

      <div class="location-filter-row">
        <label>
          Radio
          <select id="location-radius">
            <option value="50">50 km</option>
            <option value="100" selected>100 km</option>
            <option value="250">250 km</option>
          </select>
        </label>

        <label>
          Fechas
          <select id="location-days">
            <option value="7">7 días</option>
            <option value="30" selected>30 días</option>
            <option value="365">Toda la programación</option>
          </select>
        </label>
      </div>

      <div
        class="location-results"
        id="location-results"
      >
        <div class="location-empty-state">
          Elige tu ubicación o busca una ciudad.
        </div>
      </div>

      <button
        type="button"
        class="location-explorer-close"
        data-close-location-explorer
      >
        Cerrar
      </button>
    </section>
  `;

  document.body.appendChild(sheet);

  return sheet;
}


function openLocationExplorer() {
  const sheet =
    ensureLocationExplorerSheet();

  sheet.classList.add("is-open");

  sheet.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "location-explorer-open"
  );
}


function closeLocationExplorer() {
  const sheet =
    document.getElementById(
      "location-explorer-sheet"
    );

  if (!sheet) {
    return;
  }

  sheet.classList.remove("is-open");

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.classList.remove(
    "location-explorer-open"
  );
}



const LOCATION_CACHE_KEY =
  "alberotv-location-cache-v1";


function getLocationCache() {
  try {
    return JSON.parse(
      localStorage.getItem(
        LOCATION_CACHE_KEY
      ) || "{}"
    );
  } catch {
    return {};
  }
}


function saveLocationCache(cache) {
  localStorage.setItem(
    LOCATION_CACHE_KEY,
    JSON.stringify(cache)
  );
}


function cleanLocationSearchName(value) {
  let cleaned =
    String(value || "")
      .replace(
        /\b(plaza de toros|plaza monumental|coso taurino)\b/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

  /*
   * Ejemplo:
   * "Azpeitia (Guipúzcoa) España"
   * pasa a:
   * "Azpeitia, España"
   */
  const cityMatch =
    cleaned.match(
      /^([^,(]+)/
    );

  const city =
    cityMatch
      ? cityMatch[1].trim()
      : cleaned;

  const countryMatch =
    cleaned.match(
      /\b(España|Portugal|Francia|México|Colombia|Perú|Ecuador)\b/i
    );

  const country =
    countryMatch
      ? countryMatch[1]
      : "";

  return [
    city,
    country
  ]
    .filter(Boolean)
    .join(", ");
}


function getEventSearchLocation(event) {
  const location =
    cleanLocationSearchName(
      event.location ||
      event.name ||
      ""
    );

  const country =
    String(
      event.country ||
      event.countryName ||
      ""
    ).trim();

  return [
    location,
    country
  ]
    .filter(Boolean)
    .join(", ");
}


async function geocodeLocationName(name) {
  const cleanedName =
    cleanLocationSearchName(name);

  if (!cleanedName) {
    return null;
  }

  const cache =
    getLocationCache();

  const cacheKey =
    normalizeFavoriteValue(
      cleanedName
    );

  if (
    Object.prototype.hasOwnProperty.call(
      cache,
      cacheKey
    )
  ) {
    return cache[cacheKey];
  }

  try {
    const url =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(cleanedName)}` +
      "&count=1" +
      "&language=es" +
      "&format=json";

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Geocodificación: ${response.status}`
      );
    }

    const data =
      await response.json();

    const result =
      data.results?.[0];

    const location =
      result
        ? {
            latitude:
              Number(result.latitude),

            longitude:
              Number(result.longitude),

            name:
              result.name || cleanedName,

            admin:
              result.admin1 || "",

            country:
              result.country || ""
          }
        : null;

    /*
     * Solo guardamos resultados válidos.
     * Un fallo temporal no debe quedar
     * almacenado para siempre.
     */
    if (location) {
      cache[cacheKey] =
        location;

      saveLocationCache(cache);
    }

    return location;
  } catch (error) {
    console.error(
      "AlberoTV: error geocodificando",
      cleanedName,
      error
    );

    return null;
  }
}


function degreesToRadians(value) {
  return value * Math.PI / 180;
}


function calculateDistanceKm(
  latitudeA,
  longitudeA,
  latitudeB,
  longitudeB
) {
  const earthRadiusKm =
    6371;

  const latitudeDifference =
    degreesToRadians(
      latitudeB - latitudeA
    );

  const longitudeDifference =
    degreesToRadians(
      longitudeB - longitudeA
    );

  const a =
    Math.sin(
      latitudeDifference / 2
    ) ** 2 +
    Math.cos(
      degreesToRadians(latitudeA)
    ) *
    Math.cos(
      degreesToRadians(latitudeB)
    ) *
    Math.sin(
      longitudeDifference / 2
    ) ** 2;

  return (
    earthRadiusKm *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}


function getLocationSearchSettings() {
  return {
    radius:
      Number(
        document.getElementById(
          "location-radius"
        )?.value || 100
      ),

    days:
      Number(
        document.getElementById(
          "location-days"
        )?.value || 30
      )
  };
}


function eventIsInsideDateWindow(
  event,
  numberOfDays
) {
  if (!event.date) {
    return false;
  }

  const eventDate =
    new Date(
      `${event.date}T00:00:00`
    );

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  const finalDate =
    new Date(today);

  finalDate.setDate(
    finalDate.getDate() +
    numberOfDays
  );

  return (
    eventDate >= today &&
    eventDate <= finalDate
  );
}


function formatNearbyEventDate(dateValue) {
  const date =
    new Date(
      `${dateValue}T00:00:00`
    );

  return date.toLocaleDateString(
    "es-ES",
    {
      day:
        "numeric",

      month:
        "long"
    }
  );
}


function getNearbyEventKey(event) {
  return [
    event.date || "",
    event.time || "",
    event.location ||
      event.name ||
      "",
    event.type || ""
  ].join("|");
}


function buildNearbyEventMarkup(item) {
  const event =
    item.event;

  const channel =
    getEventChannel(event) ||
    "Sin TV";

  const time =
    event.time ||
    "Hora por confirmar";

  return `
    <article class="nearby-event-card">

      <div class="nearby-event-distance">
        A ${Math.round(item.distance)} km
      </div>

      <div class="nearby-event-type">
        ${escapeHtml(
          event.type ||
          "Festejo taurino"
        )}
      </div>

      <h3>
        ${escapeHtml(
          event.location ||
          event.name ||
          "Localidad por confirmar"
        )}
      </h3>

      <p>
        ${escapeHtml(
          formatNearbyEventDate(
            event.date
          )
        )}
        ·
        ${escapeHtml(time)}
        ·
        ${escapeHtml(channel)}
      </p>

      <button
        type="button"
        data-open-nearby-event="${
          encodeURIComponent(
            JSON.stringify({
              date:
                event.date,

              key:
                getNearbyEventKey(
                  event
                )
            })
          )
        }"
      >
        Ver en programación
      </button>

    </article>
  `;
}


async function findNearbyEvents({
  latitude,
  longitude,
  referenceName
}) {
  const results =
    document.getElementById(
      "location-results"
    );

  const settings =
    getLocationSearchSettings();

  const candidateEvents =
    loadedEvents.filter(
      event =>
        eventIsInsideDateWindow(
          event,
          settings.days
        )
    );

  const uniqueLocations =
    [
      ...new Set(
        candidateEvents
          .map(
            getEventSearchLocation
          )
          .filter(Boolean)
      )
    ];

  results.innerHTML = `
    <div class="location-loading">
      Buscando festejos alrededor de
      <strong>${escapeHtml(referenceName)}</strong>…
      <br>
      0 de ${uniqueLocations.length} localidades
    </div>
  `;

  const coordinatesByLocation =
    new Map();

  for (
    let index = 0;
    index < uniqueLocations.length;
    index += 1
  ) {
    const locationName =
      uniqueLocations[index];

    const coordinates =
      await geocodeLocationName(
        locationName
      );

    if (coordinates) {
      coordinatesByLocation.set(
        locationName,
        coordinates
      );
    }

    if (
      index % 4 === 0 ||
      index === uniqueLocations.length - 1
    ) {
      results.innerHTML = `
        <div class="location-loading">
          Buscando festejos alrededor de
          <strong>${escapeHtml(referenceName)}</strong>…
          <br>
          ${index + 1} de
          ${uniqueLocations.length}
          localidades
        </div>
      `;
    }
  }

  const nearbyEvents =
    candidateEvents
      .map(event => {
        const searchLocation =
          getEventSearchLocation(event);

        const coordinates =
          coordinatesByLocation.get(
            searchLocation
          );

        if (!coordinates) {
          return null;
        }

        const distance =
          calculateDistanceKm(
            latitude,
            longitude,
            coordinates.latitude,
            coordinates.longitude
          );

        return {
          event,
          distance
        };
      })
      .filter(Boolean)
      .filter(
        item =>
          item.distance <=
          settings.radius
      )
      .sort(
        (itemA, itemB) => {
          const dateComparison =
            String(
              itemA.event.date
            ).localeCompare(
              String(
                itemB.event.date
              )
            );

          if (dateComparison !== 0) {
            return dateComparison;
          }

          return (
            itemA.distance -
            itemB.distance
          );
        }
      );

  if (!nearbyEvents.length) {
    results.innerHTML = `
      <div class="location-empty-state">
        No hay festejos a menos de
        ${settings.radius} km de
        <strong>${escapeHtml(referenceName)}</strong>
        durante el periodo seleccionado.
      </div>
    `;

    return;
  }

  results.innerHTML = `
    <div class="location-results-heading">
      <strong>
        ${escapeHtml(referenceName)}
      </strong>

      <span>
        ${nearbyEvents.length}
        ${
          nearbyEvents.length === 1
            ? "festejo encontrado"
            : "festejos encontrados"
        }
      </span>
    </div>

    <div class="nearby-events-list">
      ${
        nearbyEvents
          .map(
            buildNearbyEventMarkup
          )
          .join("")
      }
    </div>

    <div class="location-attribution">
      Distancias aproximadas al centro de
      cada localidad · Geocodificación:
      Open-Meteo / GeoNames
    </div>
  `;
}


function openNearbyEvent(date) {
  closeLocationExplorer();

  const dayCard =
    document.querySelector(
      `.day[data-date="${CSS.escape(date)}"]`
    );

  if (!dayCard) {
    alert(
      "Ese día no está disponible en la programación actual."
    );

    return;
  }

  /*
   * Evitamos que scrollIntoView desplace
   * verticalmente toda la aplicación.
   */
  window.scrollTo({
    top: 0,
    behavior: "auto"
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  dayCard.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "center"
  });

  window.setTimeout(() => {
    document
      .querySelectorAll(".day")
      .forEach(card => {
        const isActive =
          card === dayCard;

        card.classList.toggle(
          "active",
          isActive
        );

        card.setAttribute(
          "aria-current",
          isActive
            ? "date"
            : "false"
        );
      });

    activeCard =
      dayCard;

    dayCard.querySelector(
      ".events"
    )?.scrollTo({
      top: 0,
      behavior: "auto"
    });

    window.scrollTo({
      top: 0,
      behavior: "auto"
    });

    updateActiveCategories();
    updateTodayButtonState();
  }, 350);
}


async function requestCurrentLocation() {
  const Geolocation =
    window.Capacitor?.Plugins?.Geolocation;

  if (!Geolocation) {
    alert(
      "La ubicación solo está disponible dentro de la app."
    );

    return;
  }

  let permission =
    await Geolocation.checkPermissions();

  if (
    permission.location !== "granted" &&
    permission.coarseLocation !== "granted"
  ) {
    permission =
      await Geolocation.requestPermissions();
  }

  if (
    permission.location !== "granted" &&
    permission.coarseLocation !== "granted"
  ) {
    alert(
      "Debes permitir la ubicación para buscar festejos cercanos."
    );

    return;
  }

  const results =
    document.getElementById(
      "location-results"
    );

  results.innerHTML = `
    <div class="location-loading">
      Obteniendo tu ubicación…
    </div>
  `;

  try {
    const position =
      await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 300000
      });

    await findNearbyEvents({
      latitude:
        position.coords.latitude,

      longitude:
        position.coords.longitude,

      referenceName:
        "tu ubicación"
    });
  } catch (error) {
    console.error(
      "AlberoTV: error obteniendo ubicación",
      error
    );

    results.innerHTML = `
      <div class="location-error-state">
        No se ha podido obtener la ubicación.
      </div>
    `;
  }
}


document.addEventListener(
  "click",
  async clickEvent => {
    if (
      clickEvent.target.closest(
        "#location-explorer-button"
      )
    ) {
      openLocationExplorer();
      return;
    }

    if (
      clickEvent.target.closest(
        "[data-close-location-explorer]"
      )
    ) {
      closeLocationExplorer();
      return;
    }

    if (
      clickEvent.target.closest(
        "[data-use-current-location]"
      )
    ) {
      await requestCurrentLocation();
      return;
    }

    const nearbyButton =
      clickEvent.target.closest(
        "[data-open-nearby-event]"
      );

    if (nearbyButton) {
      const eventData =
        JSON.parse(
          decodeURIComponent(
            nearbyButton.dataset
              .openNearbyEvent
          )
        );

      openNearbyEvent(
        eventData.date
      );
    }
  }
);


document.addEventListener(
  "submit",
  submitEvent => {
    if (
      submitEvent.target.id !==
      "location-city-form"
    ) {
      return;
    }

    submitEvent.preventDefault();

    const city =
      document
        .getElementById(
          "location-city-input"
        )
        .value
        .trim();

    const results =
      document.getElementById(
        "location-results"
      );

    results.innerHTML = `
      <div class="location-loading">
        Buscando la ciudad…
      </div>
    `;

    geocodeLocationName(city)
      .then(location => {
        if (!location) {
          results.innerHTML = `
            <div class="location-error-state">
              No hemos encontrado esa ciudad.
              Prueba escribiendo también el país.
            </div>
          `;

          return;
        }

        const referenceName = [
          location.name,
          location.admin,
          location.country
        ]
          .filter(Boolean)
          .join(", ");

        return findNearbyEvents({
          latitude:
            location.latitude,

          longitude:
            location.longitude,

          referenceName
        });
      })
      .catch(error => {
        console.error(
          "AlberoTV: error buscando ciudad",
          error
        );

        results.innerHTML = `
          <div class="location-error-state">
            No se ha podido realizar la búsqueda.
          </div>
        `;
      });
  }
);


function addTodayButton() {
  if (
    document.getElementById(
      "today-button"
    )
  ) {
    return;
  }

  const actionsRow =
    ensureTopbarActionsRow();

  if (!actionsRow) {
    return;
  }

  const button =
    document.createElement("button");

  button.id =
    "today-button";

  button.className =
    "today-button";

  button.type =
    "button";

  button.innerHTML = `
    <span>HOY</span>
  `;

  button.addEventListener(
    "click",
    scrollToToday
  );

  actionsRow.prepend(
    button
  );

  updateTodayButtonState();
}


function updateTodayButtonState() {
  const button =
    document.getElementById(
      "today-button"
    );

  if (!button) {
    return;
  }

  const isToday =
    activeCard?.dataset.offset === "0";

  button.classList.toggle(
    "is-today",
    isToday
  );

  button.setAttribute(
    "aria-pressed",
    isToday
      ? "true"
      : "false"
  );

  button.title =
    isToday
      ? "Estás viendo el día de hoy"
      : "Volver al día de hoy";
}


function injectAlberoEnhancementStyles() {
  if (
    document.getElementById(
      "alberotv-live-enhancements"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "alberotv-live-enhancements";

  style.textContent = `
    .event-compact-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 72px;
      align-items: start;
      gap: 16px;
      width: 100%;
      margin: 0 0 20px;
      padding: 0 0 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.10);
    }

    .event-header-information {
      min-width: 0;
    }

    .event-header-channel {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      align-self: start;
    }

    .channel-identity {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      width: 100%;
      min-width: 0;
      text-align: center;
    }

    .channel-name {
      display: block;
      width: 100%;
      margin-top: 6px;
      color: rgba(255, 255, 255, 0.94);
      font-size: 0.72rem;
      font-weight: 750;
      line-height: 1.1;
      text-align: center;
      overflow-wrap: anywhere;
    }

    .bullfighting-event {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      grid-template-columns: none !important;
    }

    .bullfighting-event .event-compact-header {
      flex: 0 0 auto;
      width: 100%;
    }

    .event-content-stack {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      width: 100% !important;
      min-width: 0 !important;
      grid-column: 1 / -1 !important;
    }

    .event-content-stack .event-type {
      position: relative !important;
      z-index: 4;
      align-self: flex-start !important;
      width: fit-content !important;
      max-width: 100% !important;
      margin: 0 !important;
    }

    .event-content-stack .event-title {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin: 12px 0 0 !important;
      padding: 0 !important;
      align-self: stretch !important;
      text-align: left !important;
      line-height: 1.12 !important;
      overflow-wrap: normal !important;
      word-break: normal !important;
      hyphens: none !important;
      white-space: normal !important;
    }

    .event-content-stack .event-title.location-short {
      font-size: clamp(1.35rem, 4.7vw, 1.75rem) !important;
    }

    .event-content-stack .event-title.location-medium {
      font-size: clamp(1.20rem, 4.2vw, 1.55rem) !important;
    }

    .event-content-stack .event-title.location-long {
      font-size: clamp(1.06rem, 3.7vw, 1.35rem) !important;
      line-height: 1.15 !important;
    }

    .event-content-stack .event-title.location-xlong {
      font-size: clamp(0.94rem, 3.35vw, 1.18rem) !important;
      line-height: 1.18 !important;
    }

    .event-content-stack .people,
    .event-content-stack .breeding {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      align-self: stretch !important;
      text-align: left !important;
      overflow-wrap: break-word !important;
      word-break: normal !important;
      hyphens: none !important;
    }

    .event-content-stack .people {
      margin: 12px 0 0 !important;
    }

    .event-content-stack .breeding {
      margin: 10px 0 0 !important;
    }

    .event-content-stack .event-link {
      align-self: flex-start !important;
      margin: 12px 0 0 !important;
    }


    .event-content-stack {
      position: relative !important;
    }

    .country-corner {
      position: absolute !important;
      z-index: 3;
      top: 0 !important;
      right: 0 !important;
      margin: 0 !important;
      transform: none !important;
      width: 40px;
      height: 40px;
      clip-path: polygon(100% 0, 100% 100%, 0 0);
      pointer-events: none;
      filter: saturate(1.08);
    }

    .country-corner::after {
      display: none;
      content: none;
    }

    .country-es {
      background: linear-gradient(
        135deg,
        #c8102e 0 31%,
        #ffcd00 31% 69%,
        #c8102e 69% 100%
      );
    }

    .country-fr {
      background: linear-gradient(
        135deg,
        #0055a4 0 33.33%,
        #ffffff 33.33% 66.66%,
        #ef4135 66.66% 100%
      );
    }

    .country-pt {
      background: linear-gradient(
        135deg,
        #046a38 0 40%,
        #da291c 40% 100%
      );
    }

    .country-mx {
      background: linear-gradient(
        135deg,
        #006847 0 33.33%,
        #ffffff 33.33% 66.66%,
        #ce1126 66.66% 100%
      );
    }

    .country-co {
      background: linear-gradient(
        135deg,
        #fcd116 0 50%,
        #003893 50% 75%,
        #ce1126 75% 100%
      );
    }

    .country-pe {
      background: linear-gradient(
        135deg,
        #d91023 0 33.33%,
        #ffffff 33.33% 66.66%,
        #d91023 66.66% 100%
      );
    }

    .country-ec {
      background: linear-gradient(
        135deg,
        #ffdd00 0 50%,
        #034ea2 50% 75%,
        #ed1c24 75% 100%
      );
    }

    .bullfighting-event {
      --event-accent: #e83e8c;
    }

    .bullfighting-event.type-corrida {
      --event-accent: #e83e8c;
    }

    .bullfighting-event.type-rejones {
      --event-accent: #a64cc3;
    }

    .bullfighting-event.type-novillada,
    .bullfighting-event.type-novillada-picadores,
    .bullfighting-event.type-novillada-sin-picadores {
      --event-accent: #e6aa00;
    }

    .bullfighting-event.type-recortes {
      --event-accent: #2fc18c;
    }

    .bullfighting-event.type-festival,
    .bullfighting-event.type-mixta,
    .bullfighting-event.type-other {
      --event-accent: #8799ad;
    }

    .bullfighting-event.type-tentadero,
    .bullfighting-event.type-clase-practica,
    .bullfighting-event.type-becerrada {
      --event-accent: #59a8e8;
    }

    .bullfighting-event .event-detail-icon {
      color: var(--event-accent) !important;
    }

    .today-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 36px;
      padding: 8px 14px;
      margin-left: 10px;
      border: 1px solid rgba(255, 224, 102, 0.72);
      border-radius: 10px;
      background: rgba(255, 230, 128, 0.42);
      color: rgba(255, 248, 205, 0.92);
      box-shadow:
        0 4px 12px rgba(0, 0, 0, 0.14),
        inset 0 0 0 1px rgba(255, 255, 255, 0.08);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 900;
      line-height: 1;
      letter-spacing: 0.035em;
      cursor: pointer;
      transition:
        background 170ms ease,
        color 170ms ease,
        border-color 170ms ease,
        box-shadow 170ms ease,
        transform 170ms ease;
    }

    .today-button:hover {
      transform: translateY(-1px);
      background: rgba(255, 231, 128, 0.58);
      border-color: rgba(255, 230, 118, 0.92);
      color: #fff8cf;
    }

    .today-button.is-today {
      background: linear-gradient(
        180deg,
        #fff3a0 0%,
        #ffe46a 100%
      );
      border-color: #fff2a2;
      color: #4a3900;
      box-shadow:
        0 0 0 1px rgba(255, 241, 149, 0.38),
        0 0 18px rgba(255, 222, 73, 0.55),
        0 7px 18px rgba(0, 0, 0, 0.20);
    }

    .today-button.is-today:hover {
      background: linear-gradient(
        180deg,
        #fff7b9 0%,
        #ffe977 100%
      );
      color: #3f3000;
    }

    .today-button:active {
      transform: translateY(0);
    }

    .today-button:focus-visible {
      outline: 3px solid rgba(255, 226, 91, 0.35);
      outline-offset: 3px;
    }

    .today-button svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .event-detail-row {
      display: grid !important;
      grid-template-columns: 25px minmax(0, 1fr);
      align-items: start;
      gap: 11px;
      width: 100%;
      min-width: 0;
    }

    .event-detail-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 25px;
      height: 25px;
      margin-top: 0;
      color: var(--event-accent);
      flex: 0 0 25px;
      opacity: 1;
    }

    .event-detail-icon svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    .event-detail-row .people,
    .event-detail-row .breeding {
      padding-top: 1px;
      line-height: 1.34;
    }

    .event-detail-row .people,
    .event-detail-row .breeding {
      margin: 0 !important;
    }

    .event-detail-row.participants-row {
      margin-top: 12px;
    }

    .event-detail-row.breeding-row {
      margin-top: 10px;
    }

    .event-compact-header .event-topline {
      margin: 0;
    }

    .event-compact-header .time-local {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 4px 7px;
    }

    .event-compact-header .time-main {
      font-size: 1.55rem;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -0.035em;
    }

    .event-compact-header .time-origin {
      flex-basis: 100%;
      margin-top: 4px;
      color: rgba(255, 255, 255, 0.56);
      font-size: 0.72rem;
      font-weight: 650;
      line-height: 1.2;
    }

    .event-compact-header .time-day-shift {
      padding: 3px 6px;
      border-radius: 999px;
      font-size: 0.56rem;
      line-height: 1;
    }

    .event-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      width: fit-content;
      max-width: 100%;
      margin: 9px 0 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      font-size: 0.72rem;
      font-weight: 850;
      line-height: 1.2;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .event-status-light {
      width: 7px;
      height: 7px;
      flex: 0 0 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 0 0 currentColor;
    }

    .event-status-today {
      color: #73d99c;
    }

    .event-status-tomorrow {
      color: #65b7ff;
    }

    .event-status-future,
    .event-status-upcoming {
      color: rgba(255, 255, 255, 0.66);
    }

    .event-status-starting-soon {
      color: #ffb052;
    }

    .event-status-live {
      color: #ff595f;
    }

    .event-status-live .event-status-light {
      animation: alberotv-live-light 1.25s ease-in-out infinite;
    }

    .event-status-finished {
      color: rgba(255, 255, 255, 0.38);
    }

    .channel-logo-circle {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      flex: 0 0 48px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.96);
      box-shadow:
        0 7px 18px rgba(0, 0, 0, 0.18),
        inset 0 0 0 1px rgba(0, 0, 0, 0.035);
    }

    .channel-logo-circle img {
      display: block;
      width: 72%;
      height: 72%;
      object-fit: contain;
      object-position: center;
    }

    .channel-logo-fallback {
      display: none;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      padding: 5px;
      color: #17304e;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 0.66rem;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -0.02em;
      text-align: center;
    }

    .channel-logo-generic .channel-logo-fallback,
    .channel-logo-circle.logo-missing .channel-logo-fallback {
      display: flex;
    }

    .channel-logo-unconfirmed {
      width: 38px;
      height: 38px;
      flex-basis: 38px;
      border-style: dashed;
      background: rgba(255, 255, 255, 0.045);
      color: rgba(255, 255, 255, 0.34);
      box-shadow: none;
      font-size: 0.84rem;
      font-weight: 800;
    }

    .broadcast-unconfirmed-label {
      margin-top: 6px;
      color: rgba(255, 255, 255, 0.35);
      font-size: 0.62rem;
      font-weight: 650;
      line-height: 1.2;
      letter-spacing: 0.015em;
    }

    .event:has(.event-status-live) .channel-logo-circle:not(.channel-logo-unconfirmed) {
      border-color: rgba(255, 89, 95, 0.82);
      animation: alberotv-channel-live-ring 1.45s ease-in-out infinite;
    }

    @keyframes alberotv-live-light {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
        box-shadow:
          0 0 0 0 rgba(255, 89, 95, 0.55),
          0 0 8px 2px rgba(255, 89, 95, 0.4);
      }

      50% {
        opacity: 0.45;
        transform: scale(0.72);
        box-shadow:
          0 0 0 7px rgba(255, 89, 95, 0),
          0 0 3px 1px rgba(255, 89, 95, 0.2);
      }
    }

    @keyframes alberotv-channel-live-ring {
      0%,
      100% {
        box-shadow:
          0 0 0 0 rgba(255, 89, 95, 0.42),
          0 7px 18px rgba(0, 0, 0, 0.18);
      }

      50% {
        box-shadow:
          0 0 0 6px rgba(255, 89, 95, 0),
          0 7px 18px rgba(0, 0, 0, 0.18);
      }
    }

    @media (max-width: 800px) {
      .today-button {
        min-height: 32px;
        padding: 7px 10px;
        margin-left: 7px;
        font-size: 0.70rem;
      }

      .today-button svg {
        width: 16px;
        height: 16px;
      }

      .event-compact-header {
        grid-template-columns: minmax(0, 1fr) 64px;
        gap: 12px;
        margin-bottom: 13px;
        padding-bottom: 12px;
      }

      .event-status {
        margin-top: 7px;
        font-size: 0.64rem;
        letter-spacing: 0.035em;
      }

      .event-compact-header .time-main {
        font-size: 1.38rem;
      }

      .event-compact-header .time-origin {
        font-size: 0.66rem;
      }

      .channel-logo-circle {
        width: 42px;
        height: 42px;
        flex-basis: 42px;
      }

      .channel-name {
        margin-top: 5px;
        font-size: 0.66rem;
        line-height: 1.08;
      }


      .country-corner {
        width: 32px;
        height: 32px;
        top: 0 !important;
        right: 0 !important;
        margin: 0 !important;
        transform: none !important;
      }

      .event-detail-row {
        grid-template-columns: 22px minmax(0, 1fr);
        gap: 9px;
      }

      .event-detail-icon {
        width: 22px;
        height: 22px;
        flex-basis: 22px;
        margin-top: 1px;
      }

      .event-content-stack .event-title {
        margin-top: 10px !important;
      }

      .event-content-stack .people {
        margin-top: 10px !important;
      }

      .event-content-stack .event-title.location-long {
        font-size: clamp(1rem, 4.9vw, 1.22rem) !important;
      }

      .event-content-stack .event-title.location-xlong {
        font-size: clamp(0.90rem, 4.45vw, 1.08rem) !important;
      }

      .channel-logo-unconfirmed {
        width: 34px;
        height: 34px;
        flex-basis: 34px;
      }

      .broadcast-unconfirmed-label {
        font-size: 0.58rem;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .event-status-live .event-status-light,
      .event:has(.event-status-live) .channel-logo-circle:not(.channel-logo-unconfirmed) {
        animation: none;
      }
    }
  `;

  document.head.appendChild(
    style
  );
}


/* ==================================================
   CATEGORÍAS DE LA CABECERA
   ================================================== */

function getHeaderCategory(event = {}) {
  if (isProgram(event)) {
    return "programas";
  }

  const type = normalizeText(event.type);

  if (
    type.includes("rejones") ||
    type.includes("rejoneo") ||
    type.includes("rejoneadores")
  ) {
    return "rejones";
  }

  if (
    type.includes("novillada") ||
    type.includes("novillos")
  ) {
    return "novilladas";
  }

  if (
    type.includes("recortes") ||
    type.includes("recortadores") ||
    type.includes("concurso de recortes")
  ) {
    return "recortes";
  }

  if (
    type.includes("corrida") ||
    type.includes("toros")
  ) {
    return "corridas";
  }

  return "otros";
}


function scrollToCategory(categoryKey) {
  const todayKey = toLocalISO(new Date());

  const matchingEvent = loadedEvents
    .filter(event => getHeaderCategory(event) === categoryKey)
    .sort((eventA, eventB) => {
      const dateComparison = String(eventA.date || "").localeCompare(
        String(eventB.date || "")
      );

      if (dateComparison !== 0) {
        return dateComparison;
      }

      return String(eventA.time || "99:99").localeCompare(
        String(eventB.time || "99:99")
      );
    })
    .find(event => String(event.date || "") >= todayKey);

  if (!matchingEvent) {
    return;
  }

  const targetCard = cards.find(
    card => card.dataset.date === matchingEvent.date
  );

  if (!targetCard) {
    return;
  }

  timeline.scrollTo({
    left:
      targetCard.offsetLeft -
      timeline.clientWidth / 2 +
      targetCard.offsetWidth / 2,
    behavior: "smooth"
  });

}


function renderCategoryNavigation(events = []) {
  if (!categoryList) return;
  const categoryDefinitions = [
    { key: "corridas", icon: "🐂", label: "CORRIDAS" },
    { key: "rejones", icon: "🐎", label: "REJONES" },
    { key: "novilladas", icon: "🐂", label: "NOVILLADAS" },
    { key: "recortes", icon: "🤸", label: "RECORTES" },
    { key: "programas", icon: "📺", label: "PROGRAMAS" }
  ];
  const categoryCounts = events.reduce((counts, event) => {
    const category = getHeaderCategory(event);
    if (Object.prototype.hasOwnProperty.call(counts, category)) counts[category] += 1;
    return counts;
  }, { corridas: 0, rejones: 0, novilladas: 0, recortes: 0, programas: 0 });
  const visibleCategories = categoryDefinitions.filter(category => categoryCounts[category.key] > 0);
  categoryList.innerHTML = visibleCategories.map(category => `
    <button class="category-pill ${category.key}" type="button" data-category="${category.key}" aria-label="Ir al próximo contenido de ${category.label.toLowerCase()}. ${categoryCounts[category.key]} elementos.">
      <span class="category-icon" aria-hidden="true">${category.icon}</span>
      <span class="category-name">${category.label}</span>
      <span class="category-count" aria-hidden="true">${categoryCounts[category.key]}</span>
    </button>
  `).join("");
  categoryList.querySelectorAll(".category-pill").forEach(button => {
    button.addEventListener("click", () => scrollToCategory(button.dataset.category));
  });
}

function updateActiveCategories() {
  if (!activeCard || !categoryList) return;
  const activeDate = activeCard.dataset.date;
  const categoriesForActiveDay = new Set(
    loadedEvents.filter(event => event.date === activeDate).map(getHeaderCategory)
  );
  categoryList.querySelectorAll(".category-pill").forEach(button => {
    const isActive = categoriesForActiveDay.has(button.dataset.category);
    button.classList.toggle("active-category", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}


/* ==================================================
   CLASIFICACIÓN DEL TIPO DE FESTEJO
   ================================================== */

function getTypeClass(type = "") {
  const normalizedType = normalizeText(type);

  if (
    normalizedType.includes("rejones") ||
    normalizedType.includes("rejoneo") ||
    normalizedType.includes("rejoneadores")
  ) {
    return "type-rejones";
  }

  if (
    normalizedType.includes("novillada con picadores") ||
    normalizedType.includes("novillada picada") ||
    normalizedType.includes("novillos con picadores")
  ) {
    return "type-novillada-picadores";
  }

  if (
    normalizedType.includes("novillada sin picadores") ||
    normalizedType.includes("novillada sin caballos") ||
    normalizedType.includes("novillos sin picadores")
  ) {
    return "type-novillada-sin-picadores";
  }

  if (
    normalizedType.includes("novillada")
  ) {
    return "type-novillada";
  }

  if (
    normalizedType.includes("festival")
  ) {
    return "type-festival";
  }

  if (
    normalizedType.includes("recortes") ||
    normalizedType.includes("recortadores") ||
    normalizedType.includes("concurso de recortes")
  ) {
    return "type-recortes";
  }

  if (
    normalizedType.includes("clase practica") ||
    normalizedType.includes("clase práctica")
  ) {
    return "type-clase-practica";
  }

  if (
    normalizedType.includes("becerrada") ||
    normalizedType.includes("becerros")
  ) {
    return "type-becerrada";
  }

  if (
    normalizedType.includes("tentadero") ||
    normalizedType.includes("tienta")
  ) {
    return "type-tentadero";
  }

  if (
    normalizedType.includes("mixta") ||
    normalizedType.includes("mixto")
  ) {
    return "type-mixta";
  }

  if (
    normalizedType.includes("corrida de toros") ||
    normalizedType.includes("corrida") ||
    normalizedType.includes("toros")
  ) {
    return "type-corrida";
  }

  return "type-other";
}


/* ==================================================
   CREAR PROGRAMA TAURINO
   ================================================== */

function buildProgram(event) {
  const title =
    event.title ||
    event.name ||
    "Programa taurino";

  const channel =
    event.channel ||
    event.source ||
    "Canal por confirmar";

  const eventUrl =
    event.eventUrl ||
    event.sourceUrl ||
    "";

  return `
    <article class="event program-event">

      <div class="program-heading">

        <span
          class="program-icon"
          aria-hidden="true"
        >
          📺
        </span>

        <span class="program-label">
          PROGRAMA TAURINO
        </span>

      </div>

      ${buildEventHeaderMarkup(event)}

      <div class="event-content-stack">

        <h2 class="event-title program-title">
          ${escapeHtml(title)}
        </h2>

        <div class="program-description">
          Actualidad y contenidos del mundo taurino
        </div>

        ${
          eventUrl
            ? `
              <a
                class="event-link program-link"
                href="${escapeHtml(eventUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver emisión
              </a>
            `
            : ""
        }

        <div class="event-action-row">
          ${buildNotificationButtonMarkup(event)}
          ${buildFavoriteButtonMarkup(event)}
        </div>

      </div>

    </article>
  `;
}


/* ==================================================
   CREAR FESTEJO
   ================================================== */


/* ==================================================
   NOTIFICACIONES LOCALES
   ================================================== */

let pendingNotificationEvent = null;
let pendingNotificationButton = null;

const DEFAULT_NOTIFICATION_MINUTES = 30;
const MIN_NOTIFICATION_MINUTES = 5;
const MAX_NOTIFICATION_MINUTES = 24 * 60;


function getLocalNotificationsPlugin() {
  return (
    window.Capacitor?.Plugins?.LocalNotifications ||
    null
  );
}


function getEventNotificationId(event) {
  const text = [
    event.date || "",
    event.time || "",
    event.location || event.name || "",
    event.type || ""
  ].join("|");

  let hash = 0;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    hash =
      ((hash << 5) - hash) +
      text.charCodeAt(index);

    hash |= 0;
  }

  return Math.abs(hash) || 1;
}


function getNotificationStorageKey(event) {
  return (
    "alberotv-notification-" +
    getEventNotificationId(event)
  );
}


function getStoredNotificationMinutes(event) {
  const storedValue =
    localStorage.getItem(
      getNotificationStorageKey(event)
    );

  const minutes =
    Number(storedValue);

  if (
    Number.isFinite(minutes) &&
    minutes >= MIN_NOTIFICATION_MINUTES &&
    minutes <= MAX_NOTIFICATION_MINUTES
  ) {
    return minutes;
  }

  return null;
}


function getLastNotificationMinutes() {
  const storedValue =
    Number(
      localStorage.getItem(
        "alberotv-last-notification-minutes"
      )
    );

  if (
    Number.isFinite(storedValue) &&
    storedValue >= MIN_NOTIFICATION_MINUTES &&
    storedValue <= MAX_NOTIFICATION_MINUTES
  ) {
    return storedValue;
  }

  return DEFAULT_NOTIFICATION_MINUTES;
}


function formatNotificationLeadTime(minutes) {
  if (minutes === 60) {
    return "1 hora";
  }

  if (
    minutes > 60 &&
    minutes % 60 === 0
  ) {
    return `${minutes / 60} horas`;
  }

  return `${minutes} min`;
}


function buildNotificationButtonMarkup(event) {
  const isNativeApp =
    window.Capacitor?.isNativePlatform?.() === true;

  if (
    !isNativeApp ||
    !event.date ||
    !event.time
  ) {
    return "";
  }

  const activeMinutes =
    getStoredNotificationMinutes(event);

  const encodedEvent =
    encodeURIComponent(
      JSON.stringify({
        date: event.date,
        time: event.time,
        location:
          event.location ||
          event.name ||
          "Festejo taurino",
        type:
          event.type ||
          "Festejo taurino"
      })
    );

  return `
    <button
      class="event-notification-button ${
        activeMinutes
          ? "notification-active"
          : ""
      }"
      type="button"
      data-notification-event="${encodedEvent}"
    >
      ${
        activeMinutes
          ? `✓ Aviso: ${formatNotificationLeadTime(
              activeMinutes
            )}`
          : "🔔 Avisarme"
      }
    </button>
  `;
}


function getEventStartDate(event) {
  /*
   * La hora publicada del festejo corresponde a Madrid.
   * La convertimos primero a un instante UTC real.
   *
   * El iPhone mostrará y programará ese instante
   * automáticamente en la hora local del usuario.
   */
  return getEventStartInstant(event);
}


function ensureNotificationSheet() {
  let sheet =
    document.getElementById(
      "notification-sheet"
    );

  if (sheet) {
    return sheet;
  }

  sheet =
    document.createElement("div");

  sheet.id =
    "notification-sheet";

  sheet.className =
    "notification-sheet";

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  sheet.innerHTML = `
    <div
      class="notification-sheet-backdrop"
      data-close-notification-sheet
    ></div>

    <section
      class="notification-sheet-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-sheet-title"
    >
      <div class="notification-sheet-handle"></div>

      <h2 id="notification-sheet-title">
        ¿Cuándo quieres el aviso?
      </h2>

      <p class="notification-sheet-event">
      </p>

      <div class="notification-options">
        <button
          type="button"
          data-notification-minutes="15"
        >
          15 minutos antes
        </button>

        <button
          type="button"
          data-notification-minutes="30"
        >
          30 minutos antes
        </button>

        <button
          type="button"
          data-notification-minutes="60"
        >
          1 hora antes
        </button>

        <button
          type="button"
          class="notification-custom-toggle"
          data-open-custom-notification
        >
          Personalizar
        </button>
      </div>

      <div
        class="notification-custom-area"
        hidden
      >
        <label for="notification-custom-amount">
          Avisarme
        </label>

        <div class="notification-custom-row">

          <input
            id="notification-custom-amount"
            type="number"
            inputmode="numeric"
            min="1"
            max="1440"
            step="1"
            value="30"
            aria-label="Cantidad de tiempo"
          >

          <select
            id="notification-custom-unit"
            aria-label="Unidad de tiempo"
          >
            <option value="minutes">
              minutos antes
            </option>

            <option value="hours">
              horas antes
            </option>
          </select>

          <button
            type="button"
            data-confirm-custom-notification
          >
            Guardar
          </button>

        </div>

        <small>
          Mínimo 5 minutos y máximo 24 horas.
        </small>
      </div>

      <button
        type="button"
        class="notification-cancel-active"
        data-cancel-event-notification
        hidden
      >
        Cancelar aviso
      </button>

      <button
        type="button"
        class="notification-sheet-close"
        data-close-notification-sheet
      >
        Cerrar
      </button>
    </section>
  `;

  document.body.appendChild(sheet);

  return sheet;
}


function openNotificationSheet(
  event,
  button
) {
  const sheet =
    ensureNotificationSheet();

  pendingNotificationEvent =
    event;

  pendingNotificationButton =
    button;

  const eventText =
    sheet.querySelector(
      ".notification-sheet-event"
    );

  const customAmountInput =
    sheet.querySelector(
      "#notification-custom-amount"
    );

  const customUnitSelect =
    sheet.querySelector(
      "#notification-custom-unit"
    );

  const customArea =
    sheet.querySelector(
      ".notification-custom-area"
    );

  const cancelButton =
    sheet.querySelector(
      ".notification-cancel-active"
    );

  const activeMinutes =
    getStoredNotificationMinutes(event);

  eventText.textContent =
    `${event.type} · ${event.location} · ${event.time}`;

  const selectedMinutes =
    activeMinutes ||
    getLastNotificationMinutes();

  if (
    selectedMinutes >= 60 &&
    selectedMinutes % 60 === 0
  ) {
    customAmountInput.value =
      selectedMinutes / 60;

    customUnitSelect.value =
      "hours";
  } else {
    customAmountInput.value =
      selectedMinutes;

    customUnitSelect.value =
      "minutes";
  }

  customArea.hidden =
    true;

  cancelButton.hidden =
    !activeMinutes;

  sheet.classList.add(
    "is-open"
  );

  sheet.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "notification-sheet-open"
  );
}


function closeNotificationSheet() {
  const sheet =
    document.getElementById(
      "notification-sheet"
    );

  if (!sheet) {
    return;
  }

  sheet.classList.remove(
    "is-open"
  );

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.classList.remove(
    "notification-sheet-open"
  );

  pendingNotificationEvent =
    null;

  pendingNotificationButton =
    null;
}


async function cancelEventNotification(
  event,
  button
) {
  const LocalNotifications =
    getLocalNotificationsPlugin();

  if (!LocalNotifications) {
    return;
  }

  const notificationId =
    getEventNotificationId(event);

  await LocalNotifications.cancel({
    notifications: [
      {
        id: notificationId
      }
    ]
  });

  localStorage.removeItem(
    getNotificationStorageKey(event)
  );

  if (button) {
    button.classList.remove(
      "notification-active"
    );

    button.textContent =
      "🔔 Avisarme";
  }

  closeNotificationSheet();
}


async function scheduleEventNotification(
  event,
  button,
  minutesBefore
) {
  const LocalNotifications =
    getLocalNotificationsPlugin();

  if (!LocalNotifications) {
    alert(
      "Las notificaciones solo están disponibles dentro de la app."
    );

    return;
  }

  const minutes =
    Number(minutesBefore);

  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_NOTIFICATION_MINUTES ||
    minutes > MAX_NOTIFICATION_MINUTES
  ) {
    alert(
      "Elige un tiempo entre 5 minutos y 24 horas."
    );

    return;
  }

  let permission =
    await LocalNotifications.checkPermissions();

  if (permission.display !== "granted") {
    permission =
      await LocalNotifications.requestPermissions();
  }

  if (permission.display !== "granted") {
    alert(
      "Debes permitir las notificaciones en los ajustes del iPhone."
    );

    return;
  }

  const eventStart =
    getEventStartDate(event);

  if (!eventStart) {
    alert(
      "No se ha podido interpretar la fecha del festejo."
    );

    return;
  }

  const notificationDate =
    new Date(
      eventStart.getTime() -
      minutes * 60 * 1000
    );

  if (
    notificationDate.getTime() <=
    Date.now()
  ) {
    alert(
      `Ya es demasiado tarde para programar el aviso ${formatNotificationLeadTime(
        minutes
      )} antes.`
    );

    return;
  }

  const notificationId =
    getEventNotificationId(event);

  /*
   * Cancelamos cualquier aviso anterior del mismo festejo
   * antes de programar el nuevo.
   */
  await LocalNotifications.cancel({
    notifications: [
      {
        id: notificationId
      }
    ]
  });

  await LocalNotifications.schedule({
    notifications: [
      {
        id: notificationId,

        title:
          `AlberoTV · Comienza en ${formatNotificationLeadTime(
            minutes
          )}`,

        body:
          `${event.type} en ${event.location}, a las ${event.time}`,

        schedule: {
          at: notificationDate
        },

        sound:
          "default",

        extra: {
          date:
            event.date,

          time:
            event.time,

          location:
            event.location,

          minutesBefore:
            minutes
        }
      }
    ]
  });

  localStorage.setItem(
    getNotificationStorageKey(event),
    String(minutes)
  );

  localStorage.setItem(
    "alberotv-last-notification-minutes",
    String(minutes)
  );

  if (button) {
    button.classList.add(
      "notification-active"
    );

    button.textContent =
      `✓ Aviso: ${formatNotificationLeadTime(
        minutes
      )}`;
  }

  closeNotificationSheet();
}


document.addEventListener(
  "click",
  async clickEvent => {
    const notificationButton =
      clickEvent.target.closest(
        ".event-notification-button"
      );

    if (notificationButton) {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();

      try {
        const eventData =
          JSON.parse(
            decodeURIComponent(
              notificationButton.dataset
                .notificationEvent
            )
          );

        openNotificationSheet(
          eventData,
          notificationButton
        );
      } catch (error) {
        console.error(
          "AlberoTV: error abriendo las opciones del aviso",
          error
        );
      }

      return;
    }

    if (
      clickEvent.target.closest(
        "[data-close-notification-sheet]"
      )
    ) {
      closeNotificationSheet();
      return;
    }

    const minutesButton =
      clickEvent.target.closest(
        "[data-notification-minutes]"
      );

    if (
      minutesButton &&
      pendingNotificationEvent
    ) {
      try {
        await scheduleEventNotification(
          pendingNotificationEvent,
          pendingNotificationButton,
          Number(
            minutesButton.dataset
              .notificationMinutes
          )
        );
      } catch (error) {
        console.error(
          "AlberoTV: error programando el aviso",
          error
        );

        alert(
          "No se ha podido configurar el aviso."
        );
      }

      return;
    }

    if (
      clickEvent.target.closest(
        "[data-open-custom-notification]"
      )
    ) {
      const sheet =
        ensureNotificationSheet();

      const customArea =
        sheet.querySelector(
          ".notification-custom-area"
        );

      customArea.hidden =
        false;

      window.setTimeout(() => {
        sheet
          .querySelector(
            "#notification-custom-amount"
          )
          .focus();
      }, 50);

      return;
    }

    if (
      clickEvent.target.closest(
        "[data-confirm-custom-notification]"
      ) &&
      pendingNotificationEvent
    ) {
      const sheet =
        ensureNotificationSheet();

      const customAmount =
        Number(
          sheet.querySelector(
            "#notification-custom-amount"
          ).value
        );

      const customUnit =
        sheet.querySelector(
          "#notification-custom-unit"
        ).value;

      if (
        !Number.isInteger(customAmount) ||
        customAmount <= 0
      ) {
        alert(
          "Introduce una cantidad válida."
        );

        return;
      }

      const customMinutes =
        customUnit === "hours"
          ? customAmount * 60
          : customAmount;

      try {
        await scheduleEventNotification(
          pendingNotificationEvent,
          pendingNotificationButton,
          customMinutes
        );
      } catch (error) {
        console.error(
          "AlberoTV: error programando el aviso personalizado",
          error
        );

        alert(
          "No se ha podido configurar el aviso."
        );
      }

      return;
    }

    if (
      clickEvent.target.closest(
        "[data-cancel-event-notification]"
      ) &&
      pendingNotificationEvent
    ) {
      try {
        await cancelEventNotification(
          pendingNotificationEvent,
          pendingNotificationButton
        );
      } catch (error) {
        console.error(
          "AlberoTV: error cancelando el aviso",
          error
        );

        alert(
          "No se ha podido cancelar el aviso."
        );
      }
    }
  }
);


document.addEventListener(
  "keydown",
  keyboardEvent => {
    if (
      keyboardEvent.key === "Escape"
    ) {
      closeNotificationSheet();
    }
  }
);



/* ==================================================
   FAVORITOS
   ================================================== */

const FAVORITES_STORAGE_KEY =
  "alberotv-favorites-v1";

const FAVORITE_NOTIFICATION_IDS_KEY =
  "alberotv-favorite-notification-ids-v1";

let pendingFavoriteEvent = null;



function getEmptyFavorites() {
  return {
    events: [],
    locations: [],
    channels: [],
    participants: [],
    breedings: [],
    programs: []
  };
}



function getFavorites() {
  try {
    const stored =
      JSON.parse(
        localStorage.getItem(
          FAVORITES_STORAGE_KEY
        ) || "{}"
      );

    return {
      events:
        Array.isArray(stored.events)
          ? stored.events
          : [],

      locations:
        Array.isArray(stored.locations)
          ? stored.locations
          : [],

      channels:
        Array.isArray(stored.channels)
          ? stored.channels
          : [],

      participants:
        Array.isArray(stored.participants)
          ? stored.participants
          : [],

      breedings:
        Array.isArray(stored.breedings)
          ? stored.breedings
          : [],

      programs:
        Array.isArray(stored.programs)
          ? stored.programs
          : []
    };
  } catch (error) {
    console.error(
      "AlberoTV: error leyendo favoritos",
      error
    );

    return getEmptyFavorites();
  }
}


function saveFavorites(favorites) {
  localStorage.setItem(
    FAVORITES_STORAGE_KEY,
    JSON.stringify(favorites)
  );
}


function normalizeFavoriteValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .trim()
    .toLowerCase();
}


function getEventChannel(event) {
  return String(
    event.channel ||
    event.broadcaster ||
    event.platform ||
    ""
  ).trim();
}


function getEventParticipantNames(event) {
  const source =
    Array.isArray(event.participants)
      ? event.participants
      : (
          event.participants
            ? [event.participants]
            : []
        );

  return source
    .map(participant => {
      if (
        typeof participant === "string"
      ) {
        return participant.trim();
      }

      return String(
        participant?.name ||
        participant?.displayName ||
        participant?.title ||
        ""
      ).trim();
    })
    .filter(Boolean);
}


function getFavoriteEventKey(event) {
  return [
    event.date || "",
    event.time || "",
    event.type || "",
    event.location ||
      event.name ||
      ""
  ]
    .map(normalizeFavoriteValue)
    .join("|");
}


function getFavoriteEventLabel(event) {
  const type =
    event.type ||
    "Festejo taurino";

  const location =
    event.location ||
    event.name ||
    "Localidad por confirmar";

  const date =
    event.date || "";

  const time =
    event.time || "";

  return [
    type,
    location,
    date,
    time
  ]
    .filter(Boolean)
    .join(" · ");
}


function includesFavorite(
  favoriteValues,
  candidate
) {
  const normalizedCandidate =
    normalizeFavoriteValue(candidate);

  return favoriteValues.some(
    favorite =>
      normalizeFavoriteValue(
        favorite
      ) === normalizedCandidate
  );
}



function getEventBreedingName(event = {}) {
  return cleanBreedingDisplay(
    event.breeding || ""
  );
}


function getProgramFavoriteName(event = {}) {
  if (!isProgram(event)) {
    return "";
  }

  const candidates = [
    event.title,
    event.name,
    event.programName,
    event.location
  ];

  const ignored = new Set([
    "",
    "television",
    "televisión",
    "programa taurino"
  ]);

  return String(
    candidates.find(candidate => {
      const normalized =
        normalizeFavoriteValue(candidate);

      return (
        normalized &&
        !ignored.has(normalized)
      );
    }) ||
    event.title ||
    event.name ||
    "Programa taurino"
  ).trim();
}



function eventMatchesFavorites(
  event,
  favorites = getFavorites()
) {
  const matches = [];

  const eventKey =
    getFavoriteEventKey(event);

  if (
    favorites.events.some(
      favorite =>
        favorite?.key === eventKey
    )
  ) {
    matches.push(
      isProgram(event)
        ? "este programa"
        : "este festejo"
    );
  }

  const location =
    event.location ||
    event.name ||
    "";

  if (
    location &&
    includesFavorite(
      favorites.locations,
      location
    )
  ) {
    matches.push(
      `la plaza de ${location}`
    );
  }

  const channel =
    getEventChannel(event);

  if (
    channel &&
    includesFavorite(
      favorites.channels,
      channel
    )
  ) {
    matches.push(
      `el canal ${channel}`
    );
  }

  const breeding =
    getEventBreedingName(event);

  if (
    breeding &&
    includesFavorite(
      favorites.breedings,
      breeding
    )
  ) {
    matches.push(
      `la ganadería ${breeding}`
    );
  }

  const program =
    getProgramFavoriteName(event);

  if (
    program &&
    includesFavorite(
      favorites.programs,
      program
    )
  ) {
    matches.push(
      `el programa ${program}`
    );
  }

  getEventParticipantNames(event)
    .forEach(participant => {
      if (
        includesFavorite(
          favorites.participants,
          participant
        )
      ) {
        matches.push(participant);
      }
    });

  return matches;
}


function isEventRelatedToFavorites(event) {
  return (
    eventMatchesFavorites(event)
      .length > 0
  );
}



function encodeFavoriteEvent(event) {
  return encodeURIComponent(
    JSON.stringify({
      date:
        event.date || "",

      time:
        event.time || "",

      type:
        event.type ||
        "Festejo taurino",

      contentType:
        event.contentType || "",

      title:
        event.title || "",

      name:
        event.name || "",

      location:
        event.location ||
        event.name ||
        "Localidad por confirmar",

      channel:
        getEventChannel(event),

      participants:
        getEventParticipantNames(event),

      breeding:
        getEventBreedingName(event)
    })
  );
}


function buildFavoriteButtonMarkup(event) {
  const active =
    isEventRelatedToFavorites(event);

  return `
    <button
      class="event-favorite-button ${
        active
          ? "favorite-active"
          : ""
      }"
      type="button"
      data-favorite-event="${
        encodeFavoriteEvent(event)
      }"
    >
      ${
        active
          ? "★ Favorito"
          : "☆ Favorito"
      }
    </button>
  `;
}


function ensureFavoritesSheet() {
  let sheet =
    document.getElementById(
      "favorites-sheet"
    );

  if (sheet) {
    return sheet;
  }

  sheet =
    document.createElement("div");

  sheet.id =
    "favorites-sheet";

  sheet.className =
    "favorites-sheet";

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  sheet.innerHTML = `
    <div
      class="favorites-sheet-backdrop"
      data-close-favorites-sheet
    ></div>

    <section
      class="favorites-sheet-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="favorites-sheet-title"
    >
      <div class="favorites-sheet-handle">
      </div>

      <h2 id="favorites-sheet-title">
        Añadir a favoritos
      </h2>

      <p class="favorites-sheet-description">
        Te recordaremos el día anterior
        cuando alguno de estos favoritos
        vaya a ser televisado.
      </p>

      <div
        class="favorites-options"
        id="favorites-options"
      >
      </div>

      <button
        type="button"
        class="favorites-save-button"
        data-save-favorites
      >
        Guardar favoritos
      </button>

      <button
        type="button"
        class="favorites-sheet-close"
        data-close-favorites-sheet
      >
        Cerrar
      </button>
    </section>
  `;

  document.body.appendChild(sheet);

  return sheet;
}


function buildFavoriteOption({
  category,
  value,
  label,
  checked
}) {
  const encodedValue =
    encodeURIComponent(value);

  return `
    <label class="favorite-option">
      <input
        type="checkbox"
        data-favorite-category="${
          category
        }"
        data-favorite-value="${
          encodedValue
        }"
        ${
          checked
            ? "checked"
            : ""
        }
      >

      <span class="favorite-option-check">
      </span>

      <span class="favorite-option-text">
        ${escapeHtml(label)}
      </span>
    </label>
  `;
}



function openFavoritesSheet(
  event,
  button
) {
  pendingFavoriteEvent =
    event;

  const sheet =
    ensureFavoritesSheet();

  const favorites =
    getFavorites();

  const optionsContainer =
    sheet.querySelector(
      "#favorites-options"
    );

  const eventKey =
    getFavoriteEventKey(event);

  const location =
    event.location || "";

  const channel =
    getEventChannel(event);

  const participants =
    getEventParticipantNames(event);

  const breeding =
    getEventBreedingName(event);

  const program =
    getProgramFavoriteName(event);

  const options = [];

  options.push(
    buildFavoriteOption({
      category:
        "events",

      value:
        eventKey,

      label:
        `${
          isProgram(event)
            ? "Emisión"
            : "Festejo"
        }: ${
          getFavoriteEventLabel(event)
        }`,

      checked:
        favorites.events.some(
          favorite =>
            favorite?.key === eventKey
        )
    })
  );

  if (program) {
    options.push(
      buildFavoriteOption({
        category:
          "programs",

        value:
          program,

        label:
          `Programa: ${program}`,

        checked:
          includesFavorite(
            favorites.programs,
            program
          )
      })
    );
  }

  if (breeding) {
    options.push(
      buildFavoriteOption({
        category:
          "breedings",

        value:
          breeding,

        label:
          `Ganadería: ${breeding}`,

        checked:
          includesFavorite(
            favorites.breedings,
            breeding
          )
      })
    );
  }

  if (
    location &&
    !isProgram(event)
  ) {
    options.push(
      buildFavoriteOption({
        category:
          "locations",

        value:
          location,

        label:
          `Plaza: ${location}`,

        checked:
          includesFavorite(
            favorites.locations,
            location
          )
      })
    );
  }

  if (channel) {
    options.push(
      buildFavoriteOption({
        category:
          "channels",

        value:
          channel,

        label:
          `Canal: ${channel}`,

        checked:
          includesFavorite(
            favorites.channels,
            channel
          )
      })
    );
  }

  participants.forEach(
    participant => {
      options.push(
        buildFavoriteOption({
          category:
            "participants",

          value:
            participant,

          label:
            `Torero: ${participant}`,

          checked:
            includesFavorite(
              favorites.participants,
              participant
            )
        })
      );
    }
  );

  optionsContainer.innerHTML =
    options.join("");

  sheet.classList.add(
    "is-open"
  );

  sheet.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "favorites-sheet-open"
  );

  sheet.dataset.buttonEvent =
    button?.dataset
      ?.favoriteEvent || "";
}


function closeFavoritesSheet() {
  const sheet =
    document.getElementById(
      "favorites-sheet"
    );

  if (!sheet) {
    return;
  }

  sheet.classList.remove(
    "is-open"
  );

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.classList.remove(
    "favorites-sheet-open"
  );

  pendingFavoriteEvent =
    null;
}


function addUniqueFavorite(
  values,
  value
) {
  if (
    includesFavorite(
      values,
      value
    )
  ) {
    return values;
  }

  return [
    ...values,
    value
  ];
}


function removeFavoriteValue(
  values,
  value
) {
  const normalizedValue =
    normalizeFavoriteValue(value);

  return values.filter(
    currentValue =>
      normalizeFavoriteValue(
        currentValue
      ) !== normalizedValue
  );
}


async function saveFavoriteSelections() {
  if (!pendingFavoriteEvent) {
    return;
  }

  const sheet =
    ensureFavoritesSheet();

  const favorites =
    getFavorites();

  const checkboxes = [
    ...sheet.querySelectorAll(
      "[data-favorite-category]"
    )
  ];

  const eventKey =
    getFavoriteEventKey(
      pendingFavoriteEvent
    );

  /*
   * Festejo concreto
   */
  const eventCheckbox =
    checkboxes.find(
      checkbox =>
        checkbox.dataset
          .favoriteCategory ===
          "events"
    );

  favorites.events =
    favorites.events.filter(
      favorite =>
        favorite?.key !== eventKey
    );

  if (
    eventCheckbox?.checked
  ) {
    favorites.events.push({
      key:
        eventKey,

      label:
        getFavoriteEventLabel(
          pendingFavoriteEvent
        )
    });
  }

  /*
   * Plaza, canal y toreros
   */
  checkboxes
    .filter(
      checkbox =>
        checkbox.dataset
          .favoriteCategory !==
          "events"
    )
    .forEach(
      checkbox => {
        const category =
          checkbox.dataset
            .favoriteCategory;

        const value =
          decodeURIComponent(
            checkbox.dataset
              .favoriteValue
          );

        if (
          !Array.isArray(
            favorites[category]
          )
        ) {
          return;
        }

        if (checkbox.checked) {
          favorites[category] =
            addUniqueFavorite(
              favorites[category],
              value
            );
        } else {
          favorites[category] =
            removeFavoriteValue(
              favorites[category],
              value
            );
        }
      }
    );

  saveFavorites(favorites);

  updateFavoriteButtons();

  closeFavoritesSheet();

  await syncFavoriteNotifications(
    loadedEvents,
    true
  );
}


function updateFavoriteButtons() {
  document
    .querySelectorAll(
      ".event-favorite-button"
    )
    .forEach(button => {
      try {
        const event =
          JSON.parse(
            decodeURIComponent(
              button.dataset
                .favoriteEvent
            )
          );

        const active =
          isEventRelatedToFavorites(
            event
          );

        button.classList.toggle(
          "favorite-active",
          active
        );

        button.textContent =
          active
            ? "★ Favorito"
            : "☆ Favorito";
      } catch (error) {
        console.error(
          "AlberoTV: error actualizando favorito",
          error
        );
      }
    });
}


function getFavoriteNotificationId(
  event
) {
  const text =
    "favorite|" +
    getFavoriteEventKey(event);

  let hash = 0;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    hash =
      ((hash << 5) - hash) +
      text.charCodeAt(index);

    hash |= 0;
  }

  /*
   * Reservamos una zona distinta
   * de los avisos manuales.
   */
  return (
    Math.abs(hash % 800000000) +
    100000000
  );
}


function getFavoriteReminderDate(event) {
  if (!event.date) {
    return null;
  }

  const dateParts =
    String(event.date)
      .split("-")
      .map(Number);

  if (
    dateParts.length !== 3 ||
    dateParts.some(
      value =>
        !Number.isFinite(value)
    )
  ) {
    return null;
  }

  const reminderDate =
    new Date(
      dateParts[0],
      dateParts[1] - 1,
      dateParts[2],
      20,
      0,
      0,
      0
    );

  reminderDate.setDate(
    reminderDate.getDate() - 1
  );

  return reminderDate;
}


function getStoredFavoriteNotificationIds() {
  try {
    const stored =
      JSON.parse(
        localStorage.getItem(
          FAVORITE_NOTIFICATION_IDS_KEY
        ) || "[]"
      );

    return Array.isArray(stored)
      ? stored.filter(
          Number.isInteger
        )
      : [];
  } catch {
    return [];
  }
}


async function cancelOldFavoriteNotifications(
  LocalNotifications
) {
  const previousIds =
    getStoredFavoriteNotificationIds();

  if (!previousIds.length) {
    return;
  }

  await LocalNotifications.cancel({
    notifications:
      previousIds.map(id => ({
        id
      }))
  });

  localStorage.removeItem(
    FAVORITE_NOTIFICATION_IDS_KEY
  );
}


async function syncFavoriteNotifications(
  events,
  requestPermission = false
) {
  const LocalNotifications =
    getLocalNotificationsPlugin();

  if (
    !LocalNotifications ||
    !Array.isArray(events)
  ) {
    return;
  }

  const favorites =
    getFavorites();

  const hasFavorites =
    favorites.events.length ||
    favorites.locations.length ||
    favorites.channels.length ||
    favorites.participants.length ||
    favorites.breedings.length ||
    favorites.programs.length;

  await cancelOldFavoriteNotifications(
    LocalNotifications
  );

  if (!hasFavorites) {
    return;
  }

  let permission =
    await LocalNotifications
      .checkPermissions();

  if (
    permission.display !==
      "granted" &&
    requestPermission
  ) {
    permission =
      await LocalNotifications
        .requestPermissions();
  }

  if (
    permission.display !==
    "granted"
  ) {
    return;
  }

  const now =
    new Date();

  const notifications = [];

  events.forEach(event => {
    /*
     * Solo avisamos de festejos
     * televisados y con fecha.
     */
    if (
      isNonTelevisedEvent(event) ||
      !event.date
    ) {
      return;
    }

    const matches =
      eventMatchesFavorites(
        event,
        favorites
      );

    if (!matches.length) {
      return;
    }

    const reminderDate =
      getFavoriteReminderDate(
        event
      );

    if (
      !reminderDate ||
      reminderDate <= now
    ) {
      return;
    }

    const location =
      event.location ||
      event.name ||
      "Localidad por confirmar";

    const type =
      event.type ||
      "Festejo taurino";

    const channel =
      getEventChannel(event);

    const time =
      event.time
        ? ` a las ${event.time}`
        : "";

    const channelText =
      channel
        ? ` · ${channel}`
        : "";

    notifications.push({
      id:
        getFavoriteNotificationId(
          event
        ),

      title:
        "AlberoTV · Mañana tienes un favorito",

      body:
        `${type} en ${location}${time}${channelText}. Coincide con ${matches.join(
          ", "
        )}.`,

      schedule: {
        at:
          reminderDate
      },

      sound:
        "default",

      extra: {
        source:
          "favorite",

        date:
          event.date,

        time:
          event.time || "",

        location,

        favoriteMatches:
          matches
      }
    });
  });

  /*
   * iOS tiene un límite de avisos
   * locales pendientes. Dejamos
   * margen para los avisos manuales.
   */
  const limitedNotifications =
    notifications
      .sort(
        (a, b) =>
          new Date(
            a.schedule.at
          ) -
          new Date(
            b.schedule.at
          )
      )
      .slice(0, 40);

  if (!limitedNotifications.length) {
    return;
  }

  await LocalNotifications.schedule({
    notifications:
      limitedNotifications
  });

  localStorage.setItem(
    FAVORITE_NOTIFICATION_IDS_KEY,
    JSON.stringify(
      limitedNotifications.map(
        notification =>
          notification.id
      )
    )
  );

  console.log(
    `AlberoTV: ${
      limitedNotifications.length
    } avisos de favoritos programados`
  );
}


document.addEventListener(
  "click",
  async clickEvent => {
    const favoriteButton =
      clickEvent.target.closest(
        ".event-favorite-button"
      );

    if (favoriteButton) {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();

      try {
        const event =
          JSON.parse(
            decodeURIComponent(
              favoriteButton.dataset
                .favoriteEvent
            )
          );

        openFavoritesSheet(
          event,
          favoriteButton
        );
      } catch (error) {
        console.error(
          "AlberoTV: error abriendo favoritos",
          error
        );
      }

      return;
    }

    if (
      clickEvent.target.closest(
        "[data-close-favorites-sheet]"
      )
    ) {
      closeFavoritesSheet();
      return;
    }

    if (
      clickEvent.target.closest(
        "[data-save-favorites]"
      )
    ) {
      try {
        await saveFavoriteSelections();
      } catch (error) {
        console.error(
          "AlberoTV: error guardando favoritos",
          error
        );

        alert(
          "No se han podido guardar los favoritos."
        );
      }
    }
  }
);


document.addEventListener(
  "keydown",
  keyboardEvent => {
    if (
      keyboardEvent.key === "Escape"
    ) {
      closeFavoritesSheet();
    }
  }
);



/* ==================================================
   PANTALLA MIS FAVORITOS
   ================================================== */

function ensureFavoritesManagerButton() {
  let button =
    document.getElementById(
      "favorites-manager-button"
    );

  if (button) {
    return button;
  }

  button =
    document.createElement("button");

  button.id =
    "favorites-manager-button";

  button.className =
    "favorites-manager-button";

  button.type =
    "button";

  button.setAttribute(
    "aria-label",
    "Abrir mis favoritos"
  );

  button.innerHTML = `
    <span aria-hidden="true">
      ★
    </span>

    <span>
      Mis favoritos
    </span>
  `;

  const actionsRow =
    ensureTopbarActionsRow();

  if (actionsRow) {
    actionsRow.appendChild(
      button
    );
  } else {
    document.body.appendChild(
      button
    );
  }

  return button;
}


function ensureFavoritesManagerSheet() {
  let sheet =
    document.getElementById(
      "favorites-manager-sheet"
    );

  if (sheet) {
    return sheet;
  }

  sheet =
    document.createElement("div");

  sheet.id =
    "favorites-manager-sheet";

  sheet.className =
    "favorites-manager-sheet";

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  sheet.innerHTML = `
    <div
      class="favorites-manager-backdrop"
      data-close-favorites-manager
    ></div>

    <section
      class="favorites-manager-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="favorites-manager-title"
    >
      <div class="favorites-manager-handle">
      </div>

      <div class="favorites-manager-heading">
        <div>
          <h2 id="favorites-manager-title">
            Mis favoritos
          </h2>

          <p>
            Toreros, plazas, canales y festejos
            que estás siguiendo.
          </p>
        </div>

        <div
          class="favorites-manager-count"
          id="favorites-manager-count"
        >
          0
        </div>
      </div>

      <div
        class="favorites-manager-content"
        id="favorites-manager-content"
      >
      </div>

      <button
        type="button"
        class="favorites-delete-all"
        data-delete-all-favorites
        hidden
      >
        Borrar todos los favoritos
      </button>

      <button
        type="button"
        class="favorites-manager-close"
        data-close-favorites-manager
      >
        Cerrar
      </button>
    </section>
  `;

  document.body.appendChild(sheet);

  return sheet;
}



function getFavoritesTotal(favorites) {
  return (
    favorites.events.length +
    favorites.locations.length +
    favorites.channels.length +
    favorites.participants.length +
    favorites.breedings.length +
    favorites.programs.length
  );
}


function buildFavoritesManagerItem({
  category,
  value,
  label
}) {
  const encodedValue =
    encodeURIComponent(
      JSON.stringify(value)
    );

  return `
    <div class="favorites-manager-item">

      <div class="favorites-manager-item-label">
        ${escapeHtml(label)}
      </div>

      <button
        type="button"
        class="favorites-manager-remove"
        data-remove-favorite-category="${category}"
        data-remove-favorite-value="${encodedValue}"
        aria-label="Eliminar ${escapeHtml(label)}"
      >
        ×
      </button>

    </div>
  `;
}


function buildFavoritesManagerSection({
  title,
  icon,
  category,
  items
}) {
  if (!items.length) {
    return "";
  }

  return `
    <section class="favorites-manager-section">

      <h3>
        <span aria-hidden="true">
          ${icon}
        </span>

        ${escapeHtml(title)}

        <span class="favorites-section-count">
          ${items.length}
        </span>
      </h3>

      <div class="favorites-manager-list">
        ${
          items
            .map(item =>
              buildFavoritesManagerItem({
                category,
                value: item.value,
                label: item.label
              })
            )
            .join("")
        }
      </div>

    </section>
  `;
}



function renderFavoritesManager() {
  const sheet =
    ensureFavoritesManagerSheet();

  const favorites =
    getFavorites();

  const total =
    getFavoritesTotal(favorites);

  const content =
    sheet.querySelector(
      "#favorites-manager-content"
    );

  const count =
    sheet.querySelector(
      "#favorites-manager-count"
    );

  const deleteAllButton =
    sheet.querySelector(
      "[data-delete-all-favorites]"
    );

  count.textContent =
    String(total);

  deleteAllButton.hidden =
    total === 0;

  if (!total) {
    content.innerHTML = `
      <div class="favorites-manager-empty">

        <div class="favorites-manager-empty-icon">
          ☆
        </div>

        <h3>
          Todavía no tienes favoritos
        </h3>

        <p>
          Pulsa Favorito para seguir toreros,
          ganaderías, programas, plazas,
          canales o eventos concretos.
        </p>

      </div>
    `;

    return;
  }

  const eventItems =
    favorites.events.map(
      favorite => ({
        value:
          favorite,

        label:
          favorite?.label ||
          "Evento guardado"
      })
    );

  const locationItems =
    favorites.locations.map(
      location => ({
        value:
          location,

        label:
          location
      })
    );

  const channelItems =
    favorites.channels.map(
      channel => ({
        value:
          channel,

        label:
          channel
      })
    );

  const participantItems =
    favorites.participants.map(
      participant => ({
        value:
          participant,

        label:
          participant
      })
    );

  const breedingItems =
    favorites.breedings.map(
      breeding => ({
        value:
          breeding,

        label:
          breeding
      })
    );

  const programItems =
    favorites.programs.map(
      program => ({
        value:
          program,

        label:
          program
      })
    );

  content.innerHTML = [
    buildFavoritesManagerSection({
      title:
        "Programas",

      icon:
        "📺",

      category:
        "programs",

      items:
        programItems
    }),

    buildFavoritesManagerSection({
      title:
        "Ganaderías",

      icon:
        "🐂",

      category:
        "breedings",

      items:
        breedingItems
    }),

    buildFavoritesManagerSection({
      title:
        "Toreros",

      icon:
        "👤",

      category:
        "participants",

      items:
        participantItems
    }),

    buildFavoritesManagerSection({
      title:
        "Plazas",

      icon:
        "🏟",

      category:
        "locations",

      items:
        locationItems
    }),

    buildFavoritesManagerSection({
      title:
        "Canales",

      icon:
        "📡",

      category:
        "channels",

      items:
        channelItems
    }),

    buildFavoritesManagerSection({
      title:
        "Eventos concretos",

      icon:
        "⭐",

      category:
        "events",

      items:
        eventItems
    })
  ].join("");
}


function openFavoritesManager() {
  const sheet =
    ensureFavoritesManagerSheet();

  renderFavoritesManager();

  sheet.classList.add(
    "is-open"
  );

  sheet.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "favorites-manager-open"
  );
}


function closeFavoritesManager() {
  const sheet =
    document.getElementById(
      "favorites-manager-sheet"
    );

  if (!sheet) {
    return;
  }

  sheet.classList.remove(
    "is-open"
  );

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.classList.remove(
    "favorites-manager-open"
  );
}


async function refreshFavoritesAfterChange() {
  updateFavoriteButtons();

  renderFavoritesManager();

  await syncFavoriteNotifications(
    loadedEvents,
    false
  );
}


async function removeFavoriteFromManager(
  category,
  storedValue
) {
  const favorites =
    getFavorites();

  if (
    !Object.prototype.hasOwnProperty.call(
      favorites,
      category
    )
  ) {
    return;
  }

  if (category === "events") {
    const eventKey =
      storedValue?.key;

    favorites.events =
      favorites.events.filter(
        favorite =>
          favorite?.key !== eventKey
      );
  } else {
    favorites[category] =
      removeFavoriteValue(
        favorites[category],
        storedValue
      );
  }

  saveFavorites(favorites);

  await refreshFavoritesAfterChange();
}


async function deleteAllFavorites() {
  const confirmed =
    window.confirm(
      "¿Quieres borrar todos tus favoritos y sus recordatorios automáticos?"
    );

  if (!confirmed) {
    return;
  }

  saveFavorites(
    getEmptyFavorites()
  );

  await refreshFavoritesAfterChange();
}


document.addEventListener(
  "click",
  async clickEvent => {
    if (
      clickEvent.target.closest(
        "#favorites-manager-button"
      )
    ) {
      clickEvent.preventDefault();

      openFavoritesManager();

      return;
    }

    if (
      clickEvent.target.closest(
        "[data-close-favorites-manager]"
      )
    ) {
      closeFavoritesManager();

      return;
    }

    const removeButton =
      clickEvent.target.closest(
        "[data-remove-favorite-category]"
      );

    if (removeButton) {
      const category =
        removeButton.dataset
          .removeFavoriteCategory;

      const storedValue =
        JSON.parse(
          decodeURIComponent(
            removeButton.dataset
              .removeFavoriteValue
          )
        );

      try {
        await removeFavoriteFromManager(
          category,
          storedValue
        );
      } catch (error) {
        console.error(
          "AlberoTV: error eliminando favorito",
          error
        );

        alert(
          "No se ha podido eliminar el favorito."
        );
      }

      return;
    }

    if (
      clickEvent.target.closest(
        "[data-delete-all-favorites]"
      )
    ) {
      try {
        await deleteAllFavorites();
      } catch (error) {
        console.error(
          "AlberoTV: error borrando favoritos",
          error
        );

        alert(
          "No se han podido borrar los favoritos."
        );
      }
    }
  }
);


document.addEventListener(
  "keydown",
  keyboardEvent => {
    if (
      keyboardEvent.key === "Escape"
    ) {
      closeFavoritesManager();
    }
  }
);


function buildBullfightingEvent(event) {
  const type =
    event.type ||
    "Festejo taurino";

  const typeClass =
    getTypeClass(type);

  const location =
    event.location ||
    event.name ||
    "Localidad por confirmar";

  const participants =
    formatParticipants(
      event.participants || []
    );

  const breeding =
    cleanBreedingDisplay(
      event.breeding
    );

  const locationLengthClass =
    getLocationLengthClass(location);

  return `
    <article class="event bullfighting-event ${typeClass} ${
      isNonTelevisedEvent(event)
        ? "event-non-televised"
        : "event-televised"
    }">

      ${buildEventHeaderMarkup(event)}

      <div class="event-content-stack">

        ${buildCountryCornerMarkup(event)}

        <div class="event-type ${typeClass}">
          ${escapeHtml(type)}
        </div>

        <h2 class="event-title ${locationLengthClass}">
          ${escapeHtml(location)}
        </h2>

        <div class="event-detail-row participants-row">
          ${buildPersonIconMarkup(event)}

          ${
            participants
              ? `
                <div class="people">
                  ${participants}
                </div>
              `
              : `
                <div class="people pending">
                  Cartel por confirmar
                </div>
              `
          }
        </div>

        ${
          breeding
            ? `
              <div class="event-detail-row breeding-row">
                ${buildBreedingIconMarkup(event)}

                <div class="breeding">
                  <strong>Ganadería:</strong>
                  ${escapeHtml(breeding)}
                </div>
              </div>
            `
            : ""
        }

        <div class="event-action-row">
          ${buildNotificationButtonMarkup(event)}
          ${buildFavoriteButtonMarkup(event)}
        </div>

      </div>

    </article>
  `;
}


/* ==================================================
   CREAR EVENTO SEGÚN SU CONTENIDO
   ================================================== */

function buildEvent(event) {
  try {
    if (isProgram(event)) {
      return buildProgram(event);
    }

    return buildBullfightingEvent(event);
  } catch (error) {
    console.error(
      "AlberoTV: error renderizando un evento",
      event,
      error
    );

    return `
      <article class="event bullfighting-event event-render-error">
        <div class="event-content-stack">
          <div class="event-type type-other">
            FESTEJO TAURINO
          </div>

          <h2 class="event-title location-short">
            ${escapeHtml(
              event?.location ||
              event?.name ||
              event?.title ||
              "Información temporalmente no disponible"
            )}
          </h2>

          <div class="people pending">
            Revisa los datos de este evento.
          </div>
        </div>
      </article>
    `;
  }
}


/* ==================================================
   CREAR TARJETA DEL DÍA
   ================================================== */

function buildDayCard(date, offset, events) {
  const card =
    document.createElement("article");

  const dateKey =
    toLocalISO(date);

  card.className =
    offset === 0
      ? "day today"
      : "day";

  card.dataset.offset =
    String(offset);

  card.dataset.date =
    dateKey;

  const dayEvents =
    events
      .filter(
        event =>
          event.date === dateKey
      )
      .sort(
        (eventA, eventB) => {
          const timeComparison =
            String(
              eventA.time || "99:99"
            ).localeCompare(
              String(
                eventB.time || "99:99"
              )
            );

          if (timeComparison !== 0) {
            return timeComparison;
          }

          return String(
            eventA.title ||
            eventA.name ||
            eventA.location ||
            ""
          ).localeCompare(
            String(
              eventB.title ||
              eventB.name ||
              eventB.location ||
              ""
            ),
            "es"
          );
        }
      );

  card.innerHTML = `

    <div class="day-header">

      <div class="label">
        ${getDayLabel(offset)}
      </div>

      <div class="date">
        ${date.getDate()}
        de
        ${months[date.getMonth()].toUpperCase()}
      </div>

      <div class="weekday">
        ${weekdays[date.getDay()]}
      </div>

    </div>

    <div class="events">

      ${
        dayEvents.length
          ? dayEvents
              .map(buildEvent)
              .join("")
          : `
              <div class="empty">

                <b>
                  Sin emisiones programadas
                </b>

                <span>
                  No hay festejos ni programas
                  taurinos publicados para este día.
                </span>

              </div>
            `
      }

    </div>

    <div class="day-scroll-indicator">
      Desplaza para ver el día completo
    </div>

  `;

  return card;
}


/* ==================================================
   CALCULAR EL TAMAÑO MÁXIMO DE LA TARJETA CENTRAL
   ================================================== */

function getMaximumCenterScale() {
  /*
   * En móvil no ampliamos la tarjeta central.
   * La ampliación hacía desaparecer el borde inferior.
   */
  if (window.innerWidth <= 800) {
    return 1;
  }

  if (!timeline || !cards.length) {
    return 1;
  }

  const timelineRect =
    timeline.getBoundingClientRect();

  const referenceCard =
    cards[0];

  const cardHeight =
    referenceCard.offsetHeight;

  if (!cardHeight) {
    return 1;
  }

  const safetyMargin =
    window.innerWidth <= 800
      ? 24
      : 38;

  const availableHeight =
    timelineRect.height -
    safetyMargin;

  const maximumScaleThatFits =
    availableHeight /
    cardHeight;

  return Math.max(
    1,
    Math.min(
      1.18,
      maximumScaleThatFits
    )
  );
}


/* ==================================================
   EFECTO DE CINTA Y LUPA CENTRAL
   ================================================== */

function updateVisuals() {
  if (!cards.length) {
    return;
  }

  const timelineRect =
    timeline.getBoundingClientRect();

  const viewportCenter =
    timelineRect.left +
    timelineRect.width / 2;

  const centerScale =
    getMaximumCenterScale();

  const sideScale =
    window.innerWidth <= 800
      ? 0.72
      : 0.64;

  let closestCard = null;
  let closestIndex = 0;
  let closestDistance = Infinity;

  cards.forEach((card, index) => {
    const cardCenter =
      timelineRect.left +
      card.offsetLeft -
      timeline.scrollLeft +
      card.offsetWidth / 2;

    const signedDistance =
      cardCenter -
      viewportCenter;

    const absoluteDistance =
      Math.abs(signedDistance);

    if (
      absoluteDistance <
      closestDistance
    ) {
      closestDistance =
        absoluteDistance;

      closestCard =
        card;

      closestIndex =
        index;
    }

    const influenceDistance =
      Math.max(
        timelineRect.width * 0.45,
        1
      );

    const normalizedDistance =
      Math.min(
        absoluteDistance /
        influenceDistance,
        1
      );

    const scale =
      centerScale -
      normalizedDistance *
      (centerScale - sideScale);

    const opacity =
      1 -
      normalizedDistance * 0.70;

    const blur =
      normalizedDistance * 1.6;

    const brightnessReduction =
      signedDistance < 0
        ? 0.50
        : 0.38;

    const brightness =
      1 -
      normalizedDistance *
      brightnessReduction;

    const maximumVerticalOffset =
      window.innerWidth <= 800
        ? 15
        : 25;

    const verticalOffset =
      normalizedDistance *
      maximumVerticalOffset;

    card.style.transform =
      `
        translateY(${verticalOffset}px)
        scale(${scale})
      `;

    card.style.opacity =
      String(opacity);

    card.style.filter =
      `
        blur(${blur}px)
        brightness(${brightness})
      `;

    card.style.zIndex =
      String(
        Math.round(
          100 -
          normalizedDistance * 90
        )
      );
  });

  previousActiveCard =
    activeCard;

  activeCard =
    closestCard;

  activeIndex =
    closestIndex;

  if (
    activeCard &&
    activeCard !== previousActiveCard
  ) {
    const activeEvents =
      activeCard.querySelector(
        ".events"
      );

    if (activeEvents) {
      activeEvents.scrollTop = 0;
    }
  }

  cards.forEach(card => {
    const isActive =
      card === activeCard;

    card.classList.toggle(
      "active",
      isActive
    );

    card.setAttribute(
      "aria-current",
      isActive
        ? "date"
        : "false"
    );
  });

  updateActiveCategories();
  updateTodayButtonState();
}


function requestVisualUpdate() {
  if (animationFrameRequested) {
    return;
  }

  animationFrameRequested =
    true;

  requestAnimationFrame(() => {
    updateVisuals();

    animationFrameRequested =
      false;
  });
}


/* ==================================================
   CARGAR PROGRAMACIÓN
   ================================================== */

async function loadEvents() {
  const response =
    await fetch(
      `https://alberotv.com/data/programacion.json?ts=${Date.now()}`,
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar programacion.json: ${response.status}`
    );
  }

  const data =
    await response.json();

  const events =
    data.events || [];

  return deduplicateDisplayEvents(events);
}


/* ==================================================
   MOSTRAR ERROR
   ================================================== */

function showLoadingError(error) {
  console.error(
    "Error cargando la programación:",
    error
  );

  timeline.innerHTML = `
    <article class="day active error-card">

      <div class="day-header">

        <div class="label">
          ERROR
        </div>

        <div class="date">
          Programación no disponible
        </div>

        <div class="weekday">
          No se ha podido cargar
          programacion.json
        </div>

      </div>

      <div class="events">

        <div class="empty">

          <b>
            Revisa la actualización
            automática de AlberoTV.
          </b>

        </div>

      </div>

    </article>
  `;
}


/* ==================================================
   INICIAR WEB
   ================================================== */

async function init() {
  injectAlberoEnhancementStyles();
  ensureFavoritesManagerButton();
  ensureLocationExplorerButton();

  let events = [];

  try {
    events =
      await loadEvents();

    loadedEvents = events;

    console.log(
      `AlberoTV: ${events.length} elementos cargados`
    );

    renderCategoryNavigation(events);

    await syncFavoriteNotifications(
      events
    );
  } catch (error) {
    showLoadingError(error);

    return;
  }

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  /*
   * Construimos la cinta usando todas las fechas disponibles
   * en programacion.json.
   *
   * Como mínimo mostramos 30 días pasados y 90 futuros.
   * Si el JSON contiene eventos más antiguos o más lejanos,
   * también se incluyen automáticamente.
   */
  const validEventDates =
    events
      .map(event => String(event.date || ""))
      .filter(dateKey =>
        /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
      )
      .map(dateKey => {
        const [year, month, day] =
          dateKey.split("-").map(Number);

        return new Date(
          year,
          month - 1,
          day,
          0,
          0,
          0,
          0
        );
      })
      .filter(date =>
        !Number.isNaN(date.getTime())
      );

  const minimumVisibleDate =
    new Date(today);

  minimumVisibleDate.setDate(
    today.getDate() - 30
  );

  const maximumVisibleDate =
    new Date(today);

  maximumVisibleDate.setDate(
    today.getDate() + 90
  );

  if (validEventDates.length) {
    const earliestEventDate =
      new Date(
        Math.min(
          ...validEventDates.map(date =>
            date.getTime()
          )
        )
      );

    const latestEventDate =
      new Date(
        Math.max(
          ...validEventDates.map(date =>
            date.getTime()
          )
        )
      );

    if (
      earliestEventDate <
      minimumVisibleDate
    ) {
      minimumVisibleDate.setTime(
        earliestEventDate.getTime()
      );
    }

    if (
      latestEventDate >
      maximumVisibleDate
    ) {
      maximumVisibleDate.setTime(
        latestEventDate.getTime()
      );
    }
  }

  const firstOffset =
    Math.round(
      (
        minimumVisibleDate.getTime() -
        today.getTime()
      ) /
      86400000
    );

  const lastOffset =
    Math.round(
      (
        maximumVisibleDate.getTime() -
        today.getTime()
      ) /
      86400000
    );

  for (
    let offset = firstOffset;
    offset <= lastOffset;
    offset++
  ) {
    const date =
      new Date(today);

    date.setDate(
      today.getDate() +
      offset
    );

    timeline.appendChild(
      buildDayCard(
        date,
        offset,
        events
      )
    );
  }

  cards = [
    ...document.querySelectorAll(
      ".day"
    )
  ];

  const todayCard =
    cards.find(
      card =>
        card.dataset.offset === "0"
    );

  requestAnimationFrame(() => {
    if (todayCard) {
      scrollToToday({
        behavior: "auto",
        resetVertical: true
      });
    }

    updateVisuals();
    startTemporalStatusUpdates();
    addTodayButton();
    forceTodayOnOpen();
  });
}


/* ==================================================
   SCROLL HORIZONTAL CONTINUO
   ================================================== */

timeline.addEventListener(
  "scroll",
  () => {
    hint?.classList.add(
      "hidden"
    );

    requestVisualUpdate();
  },
  {
    passive: true
  }
);


/* ==================================================
   RUEDA Y TRACKPAD
   ================================================== */

timeline.addEventListener(
  "wheel",
  event => {
    const horizontalMovement =
      Math.abs(event.deltaX);

    const verticalMovement =
      Math.abs(event.deltaY);

    /*
     * Safari puede repartir el gesto horizontal del
     * trackpad entre deltaX y deltaY. Aceptamos cualquier
     * desplazamiento lateral claramente intencionado.
     */
    const isHorizontalGesture =
      horizontalMovement > 1 &&
      horizontalMovement >=
        verticalMovement * 0.35;

    const isShiftWheel =
      event.shiftKey &&
      verticalMovement > 0;

    if (
      isHorizontalGesture ||
      isShiftWheel
    ) {
      event.preventDefault();

      timeline.scrollLeft +=
        isShiftWheel
          ? event.deltaY
          : event.deltaX;

      requestVisualUpdate();

      return;
    }

    if (
      verticalMovement > 0 &&
      activeCard
    ) {
      const eventsContainer =
        activeCard.querySelector(
          ".events"
        );

      if (eventsContainer) {
        event.preventDefault();

        eventsContainer.scrollTop +=
          event.deltaY;
      }
    }
  },
  {
    passive: false
  }
);


/* ==================================================
   ARRASTRAR LA CINTA CON EL RATÓN
   ================================================== */

timeline.addEventListener(
  "pointerdown",
  event => {
    /*
     * El arrastre manual se usa únicamente con ratón.
     * En iPhone dejamos que iOS distinga de forma nativa
     * entre desplazamiento horizontal y vertical.
     */
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0
    ) {
      return;
    }

    if (
      event.target.closest(
        "a, button"
      )
    ) {
      return;
    }

    isDragging =
      true;

    dragMoved =
      false;

    dragStartX =
      event.clientX;

    dragStartScrollLeft =
      timeline.scrollLeft;

    timeline.classList.add(
      "is-dragging"
    );

    timeline.setPointerCapture?.(
      event.pointerId
    );
  }
);


timeline.addEventListener(
  "pointermove",
  event => {
    if (!isDragging) {
      return;
    }

    const movement =
      event.clientX -
      dragStartX;

    if (
      Math.abs(movement) >
      4
    ) {
      dragMoved =
        true;
    }

    timeline.scrollLeft =
      dragStartScrollLeft -
      movement;

    requestVisualUpdate();
  }
);


function stopDragging(event) {
  if (!isDragging) {
    return;
  }

  isDragging =
    false;

  timeline.classList.remove(
    "is-dragging"
  );

  if (
    event?.pointerId !==
    undefined
  ) {
    try {
      timeline.releasePointerCapture?.(
        event.pointerId
      );
    } catch {
      /*
        El navegador puede haber liberado
        ya el puntero.
      */
    }
  }
}


timeline.addEventListener(
  "pointerup",
  stopDragging
);


timeline.addEventListener(
  "pointercancel",
  stopDragging
);


/* ==================================================
   FLECHAS
   ================================================== */

document
  .querySelector(
    ".edge-arrow.left"
  )
  ?.addEventListener(
    "click",
    () => {
      timeline.scrollBy({
        left: -260,
        behavior: "smooth"
      });
    }
  );


document
  .querySelector(
    ".edge-arrow.right"
  )
  ?.addEventListener(
    "click",
    () => {
      timeline.scrollBy({
        left: 260,
        behavior: "smooth"
      });
    }
  );


/* ==================================================
   TECLADO
   ================================================== */

timeline.addEventListener(
  "keydown",
  event => {
    if (
      event.key === "ArrowLeft"
    ) {
      event.preventDefault();

      timeline.scrollBy({
        left: -180,
        behavior: "smooth"
      });
    }

    if (
      event.key === "ArrowRight"
    ) {
      event.preventDefault();

      timeline.scrollBy({
        left: 180,
        behavior: "smooth"
      });
    }

    if (
      event.key === "ArrowDown" &&
      activeCard
    ) {
      event.preventDefault();

      activeCard
        .querySelector(".events")
        ?.scrollBy({
          top: 100,
          behavior: "smooth"
        });
    }

    if (
      event.key === "ArrowUp" &&
      activeCard
    ) {
      event.preventDefault();

      activeCard
        .querySelector(".events")
        ?.scrollBy({
          top: -100,
          behavior: "smooth"
        });
    }
  }
);


/* ==================================================
   AJUSTE AL CAMBIAR EL TAMAÑO DE LA VENTANA
   ================================================== */

window.addEventListener(
  "resize",
  requestVisualUpdate
);


/* ==================================================
   ACTUALIZAR AL VOLVER A LA PESTAÑA
   ================================================== */

document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) {
      updateTemporalStatuses();
    }
  }
);


/* ==================================================
   ARRANCAR
   ================================================== */

init();

/* ==================================================
   APERTURA DESDE PANTALLA DE INICIO
   ================================================== */

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

window.addEventListener(
  "pageshow",
  () => {
    if (cards.length) {
      forceTodayOnOpen();
    }
  }
);

/* ==================================================
   NUEVA CABECERA ALBEROTV
   ================================================== */

function installAlberoTVBrandHeader() {
  const currentTitle =
    document.querySelector(".brand");

  if (!currentTitle) {
    return;
  }

  if (
    currentTitle.querySelector(
      ".alberotv-brand"
    )
  ) {
    return;
  }

  currentTitle.innerHTML = `
    <span class="alberotv-brand">
      <img
        class="alberotv-brand__icon"
        src="assets/alberotv-logo-2026.png"
        alt="AlberoTV"
      >
      <span class="alberotv-brand__name">
        <span class="alberotv-brand__albero">ALBERO</span>
        <span class="alberotv-brand__tv">TV</span>
      </span>
    </span>
  `;
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    installAlberoTVBrandHeader
  );
} else {
  installAlberoTVBrandHeader();
}


/* ==================================================
   CENTRADO AUTOMÁTICO DEL CARRUSEL DE DÍAS
   ================================================== */

function installTimelineAutoCenter() {
  const timelineElement =
    document.getElementById("timeline");

  if (
    !timelineElement ||
    timelineElement.dataset.autoCenterInstalled === "true"
  ) {
    return;
  }

  timelineElement.dataset.autoCenterInstalled =
    "true";

  let scrollTimer = null;
  let userIsTouching = false;
  let automaticCentering = false;

  function getNearestDayCard() {
    const dayCards = [
      ...timelineElement.querySelectorAll(".day")
    ];

    if (!dayCards.length) {
      return null;
    }

    const timelineRect =
      timelineElement.getBoundingClientRect();

    const timelineCenter =
      timelineRect.left +
      timelineRect.width / 2;

    return dayCards.reduce(
      (nearest, card) => {
        const cardRect =
          card.getBoundingClientRect();

        const cardCenter =
          cardRect.left +
          cardRect.width / 2;

        const distance =
          Math.abs(
            cardCenter -
            timelineCenter
          );

        if (
          !nearest ||
          distance < nearest.distance
        ) {
          return {
            card,
            distance
          };
        }

        return nearest;
      },
      null
    )?.card || null;
  }

  function centerNearestDay() {
    if (
      userIsTouching ||
      automaticCentering
    ) {
      return;
    }

    const nearestCard =
      getNearestDayCard();

    if (!nearestCard) {
      return;
    }

    const targetLeft =
      nearestCard.offsetLeft -
      timelineElement.clientWidth / 2 +
      nearestCard.offsetWidth / 2;

    if (
      Math.abs(
        timelineElement.scrollLeft -
        targetLeft
      ) < 2
    ) {
      return;
    }

    automaticCentering = true;

    timelineElement.scrollTo({
      left: targetLeft,
      behavior: "smooth"
    });

    window.setTimeout(() => {
      automaticCentering = false;

      document
        .querySelectorAll(".day")
        .forEach(card => {
          const isActive =
            card === nearestCard;

          card.classList.toggle(
            "active",
            isActive
          );

          card.setAttribute(
            "aria-current",
            isActive
              ? "date"
              : "false"
          );
        });

      if (
        typeof activeCard !== "undefined"
      ) {
        activeCard =
          nearestCard;
      }

      if (
        typeof updateTodayButtonState ===
        "function"
      ) {
        updateTodayButtonState();
      }
    }, 350);
  }

  function scheduleCentering() {
    window.clearTimeout(
      scrollTimer
    );

    scrollTimer =
      window.setTimeout(
        centerNearestDay,
        140
      );
  }

  timelineElement.addEventListener(
    "touchstart",
    () => {
      userIsTouching = true;

      window.clearTimeout(
        scrollTimer
      );
    },
    {
      passive: true
    }
  );

  timelineElement.addEventListener(
    "touchend",
    () => {
      userIsTouching = false;

      scheduleCentering();
    },
    {
      passive: true
    }
  );

  timelineElement.addEventListener(
    "pointerdown",
    () => {
      userIsTouching = true;

      window.clearTimeout(
        scrollTimer
      );
    },
    {
      passive: true
    }
  );

  window.addEventListener(
    "pointerup",
    () => {
      if (!userIsTouching) {
        return;
      }

      userIsTouching = false;

      scheduleCentering();
    },
    {
      passive: true
    }
  );

  timelineElement.addEventListener(
    "scroll",
    scheduleCentering,
    {
      passive: true
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    installTimelineAutoCenter
  );
} else {
  installTimelineAutoCenter();
}

window.addEventListener(
  "pageshow",
  installTimelineAutoCenter
);


/* ==================================================
   AVISOS AUTOMÁTICOS POR CATEGORÍA
   ================================================== */

const CATEGORY_ALERTS_STORAGE_KEY =
  "alberotv-category-alerts-v1";

const CATEGORY_ALERT_IDS_STORAGE_KEY =
  "alberotv-category-alert-ids-v1";

const CATEGORY_ALERT_OPTIONS = [
  {
    key: "corridas",
    label: "Todas las corridas"
  },
  {
    key: "rejones",
    label: "Todos los rejones"
  },
  {
    key: "novilladas",
    label: "Todas las novilladas"
  },
  {
    key: "recortes",
    label: "Todos los recortes"
  },
  {
    key: "programas",
    label: "Todos los programas"
  }
];


function getCategoryAlertSettings() {
  try {
    const stored =
      JSON.parse(
        localStorage.getItem(
          CATEGORY_ALERTS_STORAGE_KEY
        ) || "{}"
      );

    return {
      categories:
        Array.isArray(stored.categories)
          ? stored.categories
          : [],

      minutesBefore:
        Number.isInteger(
          Number(stored.minutesBefore)
        )
          ? Number(stored.minutesBefore)
          : 30
    };
  } catch {
    return {
      categories: [],
      minutesBefore: 30
    };
  }
}


function saveCategoryAlertSettings(settings) {
  localStorage.setItem(
    CATEGORY_ALERTS_STORAGE_KEY,
    JSON.stringify(settings)
  );
}


function getCategoryAlertId(event) {
  const text = [
    "category",
    event.date || "",
    event.time || "",
    event.type || "",
    event.title || "",
    event.name || "",
    event.location || ""
  ].join("|");

  let hash = 0;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    hash =
      ((hash << 5) - hash) +
      text.charCodeAt(index);

    hash |= 0;
  }

  return (
    1200000000 +
    Math.abs(hash % 800000000)
  );
}


function getStoredCategoryAlertIds() {
  try {
    const stored =
      JSON.parse(
        localStorage.getItem(
          CATEGORY_ALERT_IDS_STORAGE_KEY
        ) || "[]"
      );

    return Array.isArray(stored)
      ? stored.filter(Number.isInteger)
      : [];
  } catch {
    return [];
  }
}


async function cancelOldCategoryAlerts(
  LocalNotifications
) {
  const previousIds =
    getStoredCategoryAlertIds();

  if (!previousIds.length) {
    return;
  }

  await LocalNotifications.cancel({
    notifications:
      previousIds.map(id => ({
        id
      }))
  });

  localStorage.removeItem(
    CATEGORY_ALERT_IDS_STORAGE_KEY
  );
}


function getCategoryAlertEventName(event) {
  if (isProgram(event)) {
    return (
      event.title ||
      event.name ||
      "Programa taurino"
    );
  }

  return (
    event.type ||
    "Festejo taurino"
  );
}


async function syncCategoryAlerts(
  events = loadedEvents,
  requestPermission = false
) {
  const LocalNotifications =
    getLocalNotificationsPlugin();

  if (
    !LocalNotifications ||
    !Array.isArray(events)
  ) {
    return;
  }

  const settings =
    getCategoryAlertSettings();

  await cancelOldCategoryAlerts(
    LocalNotifications
  );

  if (!settings.categories.length) {
    return;
  }

  let permission =
    await LocalNotifications
      .checkPermissions();

  if (
    permission.display !== "granted" &&
    requestPermission
  ) {
    permission =
      await LocalNotifications
        .requestPermissions();
  }

  if (
    permission.display !== "granted"
  ) {
    return;
  }

  const now = Date.now();

  const notifications = [];

  events.forEach(event => {
    if (
      !event?.date ||
      !event?.time
    ) {
      return;
    }

    const category =
      getHeaderCategory(event);

    if (
      !settings.categories.includes(
        category
      )
    ) {
      return;
    }

    /*
     * Si ya existe un aviso manual para este
     * evento, evitamos enviar otro idéntico.
     */
    if (
      getStoredNotificationMinutes(event)
    ) {
      return;
    }

    const eventStart =
      getEventStartDate(event);

    if (!eventStart) {
      return;
    }

    const notificationDate =
      new Date(
        eventStart.getTime() -
        settings.minutesBefore *
        60 *
        1000
      );

    if (
      notificationDate.getTime() <= now
    ) {
      return;
    }

    const name =
      getCategoryAlertEventName(event);

    const location =
      event.location ||
      event.name ||
      "";

    const channel =
      getEventChannel(event);

    notifications.push({
      id:
        getCategoryAlertId(event),

      title:
        `AlberoTV · ${name}`,

      body:
        [
          `Empieza en ${
            formatNotificationLeadTime(
              settings.minutesBefore
            )
          }`,
          location,
          channel
        ]
          .filter(Boolean)
          .join(" · "),

      schedule: {
        at:
          notificationDate
      },

      sound:
        "default",

      extra: {
        source:
          "category",

        category,

        date:
          event.date,

        time:
          event.time,

        location
      }
    });
  });

  /*
   * Dejamos margen para avisos manuales
   * y avisos de favoritos.
   */
  const limitedNotifications =
    notifications
      .sort(
        (first, second) =>
          new Date(
            first.schedule.at
          ) -
          new Date(
            second.schedule.at
          )
      )
      .slice(0, 20);

  if (!limitedNotifications.length) {
    return;
  }

  await LocalNotifications.schedule({
    notifications:
      limitedNotifications
  });

  localStorage.setItem(
    CATEGORY_ALERT_IDS_STORAGE_KEY,
    JSON.stringify(
      limitedNotifications.map(
        notification =>
          notification.id
      )
    )
  );

  console.log(
    `AlberoTV: ${
      limitedNotifications.length
    } avisos por categoría programados`
  );
}


function buildCategoryAlertsMarkup() {
  const settings =
    getCategoryAlertSettings();

  const activeCount =
    settings.categories.length;

  return `
    <section class="category-alerts-section">

      <div class="category-alerts-heading">
        <div>
          <h3>
            🔔 Avisos por categoría
          </h3>

          <p>
            Recibe un aviso antes de todos los
            eventos de las categorías seleccionadas.
          </p>
        </div>

        <span class="category-alerts-count">
          ${activeCount}
        </span>
      </div>

      <div class="category-alerts-options">
        ${
          CATEGORY_ALERT_OPTIONS
            .map(option => `
              <label class="category-alert-option">

                <input
                  type="checkbox"
                  data-category-alert="${option.key}"
                  ${
                    settings.categories
                      .includes(option.key)
                        ? "checked"
                        : ""
                  }
                >

                <span class="category-alert-switch">
                </span>

                <span>
                  ${escapeHtml(option.label)}
                </span>

              </label>
            `)
            .join("")
        }
      </div>

      <label class="category-alert-time">
        <span>
          Avisar
        </span>

        <select
          id="category-alert-minutes"
          aria-label="Tiempo de aviso por categoría"
        >
          <option
            value="15"
            ${
              settings.minutesBefore === 15
                ? "selected"
                : ""
            }
          >
            15 minutos antes
          </option>

          <option
            value="30"
            ${
              settings.minutesBefore === 30
                ? "selected"
                : ""
            }
          >
            30 minutos antes
          </option>

          <option
            value="60"
            ${
              settings.minutesBefore === 60
                ? "selected"
                : ""
            }
          >
            1 hora antes
          </option>

          <option
            value="120"
            ${
              settings.minutesBefore === 120
                ? "selected"
                : ""
            }
          >
            2 horas antes
          </option>

          <option
            value="300"
            ${
              settings.minutesBefore === 300
                ? "selected"
                : ""
            }
          >
            5 horas antes
          </option>
        </select>
      </label>

      <button
        type="button"
        class="category-alerts-save"
        data-save-category-alerts
      >
        Guardar avisos
      </button>

      <div
        class="category-alerts-status"
        role="status"
        aria-live="polite"
      >
      </div>

    </section>
  `;
}


function renderCategoryAlertsManager() {
  const content =
    document.getElementById(
      "favorites-manager-content"
    );

  if (!content) {
    return;
  }

  content
    .querySelector(
      ".category-alerts-section"
    )
    ?.remove();

  content.insertAdjacentHTML(
    "afterbegin",
    buildCategoryAlertsMarkup()
  );
}


/*
 * Añadimos la sección cada vez que se
 * renderiza la ventana Mis favoritos.
 */
const originalRenderFavoritesManager =
  renderFavoritesManager;

renderFavoritesManager =
  function renderFavoritesManagerWithAlerts() {
    originalRenderFavoritesManager();

    renderCategoryAlertsManager();
  };


/*
 * Cuando se sincronizan los favoritos,
 * sincronizamos también las categorías.
 */
const originalSyncFavoriteNotifications =
  syncFavoriteNotifications;

syncFavoriteNotifications =
  async function syncAllAutomaticNotifications(
    events,
    requestPermission = false
  ) {
    await originalSyncFavoriteNotifications(
      events,
      requestPermission
    );

    await syncCategoryAlerts(
      events,
      requestPermission
    );
  };


document.addEventListener(
  "click",
  async clickEvent => {
    const saveButton =
      clickEvent.target.closest(
        "[data-save-category-alerts]"
      );

    if (!saveButton) {
      return;
    }

    clickEvent.preventDefault();

    const selectedCategories = [
      ...document.querySelectorAll(
        "[data-category-alert]:checked"
      )
    ].map(
      checkbox =>
        checkbox.dataset.categoryAlert
    );

    const minutesBefore =
      Number(
        document.getElementById(
          "category-alert-minutes"
        )?.value || 30
      );

    saveCategoryAlertSettings({
      categories:
        selectedCategories,

      minutesBefore
    });

    try {
      await syncCategoryAlerts(
        loadedEvents,
        true
      );

      const status =
        saveButton
          .closest(
            ".category-alerts-section"
          )
          ?.querySelector(
            ".category-alerts-status"
          );

      saveButton.textContent =
        "✓ Avisos guardados";

      saveButton.classList.add(
        "is-saved"
      );

      if (status) {
        status.textContent =
          selectedCategories.length
            ? `${
                selectedCategories.length
              } categoría${
                selectedCategories.length === 1
                  ? ""
                  : "s"
              } activada${
                selectedCategories.length === 1
                  ? ""
                  : "s"
              } · ${formatNotificationLeadTime(
                minutesBefore
              )} antes`
            : "Avisos por categoría desactivados";
      }

      window.setTimeout(() => {
        saveButton.textContent =
          "Guardar avisos";

        saveButton.classList.remove(
          "is-saved"
        );
      }, 2200);
    } catch (error) {
      console.error(
        "AlberoTV: error guardando avisos por categoría",
        error
      );

      alert(
        "No se han podido guardar los avisos por categoría."
      );
    }
  }
);


/*
 * Actualizamos los avisos al volver a abrir
 * la aplicación, por si la programación cambió.
 */
window.addEventListener(
  "pageshow",
  () => {
    window.setTimeout(() => {
      syncCategoryAlerts(
        loadedEvents,
        false
      ).catch(error => {
        console.error(
          "AlberoTV: error actualizando avisos por categoría",
          error
        );
      });
    }, 1200);
  }
);


/* ==================================================
   CERRAR MIS FAVORITOS DESLIZANDO HACIA ABAJO
   ================================================== */

function installFavoritesManagerSwipeToClose() {
  const sheet =
    ensureFavoritesManagerSheet();

  const panel =
    sheet.querySelector(
      ".favorites-manager-panel"
    );

  if (
    !panel ||
    panel.dataset.swipeCloseInstalled === "true"
  ) {
    return;
  }

  panel.dataset.swipeCloseInstalled =
    "true";

  let startY = 0;
  let currentY = 0;
  let startTime = 0;
  let dragging = false;

  function getScrollableContent() {
    return panel.querySelector(
      ".favorites-manager-content"
    );
  }

  panel.addEventListener(
    "touchstart",
    touchEvent => {
      if (
        touchEvent.touches.length !== 1
      ) {
        return;
      }

      const content =
        getScrollableContent();

      const panelRect =
        panel.getBoundingClientRect();

      const touchY =
        touchEvent.touches[0].clientY;

      const startedNearTop =
        touchY - panelRect.top <= 110;

      const contentAtTop =
        !content ||
        content.scrollTop <= 0;

      if (
        !startedNearTop &&
        !contentAtTop
      ) {
        return;
      }

      startY = touchY;
      currentY = touchY;
      startTime = Date.now();
      dragging = true;

      panel.classList.add(
        "is-swipe-dragging"
      );
    },
    {
      passive: true
    }
  );

  panel.addEventListener(
    "touchmove",
    touchEvent => {
      if (
        !dragging ||
        touchEvent.touches.length !== 1
      ) {
        return;
      }

      currentY =
        touchEvent.touches[0].clientY;

      const distance =
        Math.max(
          0,
          currentY - startY
        );

      if (distance <= 0) {
        return;
      }

      panel.style.transform =
        `translateY(${distance}px)`;

      const progress =
        Math.min(
          distance / 320,
          0.55
        );

      panel.style.opacity =
        String(1 - progress);
    },
    {
      passive: true
    }
  );

  function finishSwipe() {
    if (!dragging) {
      return;
    }

    dragging = false;

    const distance =
      Math.max(
        0,
        currentY - startY
      );

    const elapsed =
      Math.max(
        Date.now() - startTime,
        1
      );

    const velocity =
      distance / elapsed;

    const shouldClose =
      distance >= 105 ||
      (
        distance >= 55 &&
        velocity >= 0.55
      );

    panel.classList.remove(
      "is-swipe-dragging"
    );

    if (shouldClose) {
      panel.classList.add(
        "is-swipe-closing"
      );

      panel.style.transform =
        "translateY(110%)";

      panel.style.opacity =
        "0";

      window.setTimeout(() => {
        closeFavoritesManager();

        panel.classList.remove(
          "is-swipe-closing"
        );

        panel.style.transform = "";
        panel.style.opacity = "";
      }, 220);

      return;
    }

    panel.style.transform = "";
    panel.style.opacity = "";
  }

  panel.addEventListener(
    "touchend",
    finishSwipe,
    {
      passive: true
    }
  );

  panel.addEventListener(
    "touchcancel",
    finishSwipe,
    {
      passive: true
    }
  );
}


document.addEventListener(
  "DOMContentLoaded",
  installFavoritesManagerSwipeToClose
);

window.addEventListener(
  "pageshow",
  installFavoritesManagerSwipeToClose
);


/* ==================================================
   CERRAR UBICACIÓN DESLIZANDO HACIA ABAJO
   ================================================== */

function installLocationExplorerSwipeToClose() {
  const sheet =
    ensureLocationExplorerSheet();

  const panel =
    sheet.querySelector(
      ".location-explorer-panel"
    );

  if (
    !panel ||
    panel.dataset.swipeCloseInstalled === "true"
  ) {
    return;
  }

  panel.dataset.swipeCloseInstalled =
    "true";

  let startY = 0;
  let currentY = 0;
  let startTime = 0;
  let dragging = false;

  function getScrollableContent() {
    return panel.querySelector(
      ".location-results"
    );
  }

  panel.addEventListener(
    "touchstart",
    touchEvent => {
      if (
        touchEvent.touches.length !== 1
      ) {
        return;
      }

      const content =
        getScrollableContent();

      const panelRect =
        panel.getBoundingClientRect();

      const touchY =
        touchEvent.touches[0].clientY;

      const startedNearTop =
        touchY - panelRect.top <= 110;

      const contentAtTop =
        !content ||
        content.scrollTop <= 0;

      if (
        !startedNearTop &&
        !contentAtTop
      ) {
        return;
      }

      startY = touchY;
      currentY = touchY;
      startTime = Date.now();
      dragging = true;

      panel.classList.add(
        "is-swipe-dragging"
      );
    },
    {
      passive: true
    }
  );

  panel.addEventListener(
    "touchmove",
    touchEvent => {
      if (
        !dragging ||
        touchEvent.touches.length !== 1
      ) {
        return;
      }

      currentY =
        touchEvent.touches[0].clientY;

      const distance =
        Math.max(
          0,
          currentY - startY
        );

      if (distance <= 0) {
        return;
      }

      panel.style.transform =
        `translateY(${distance}px)`;

      const progress =
        Math.min(
          distance / 320,
          0.55
        );

      panel.style.opacity =
        String(1 - progress);
    },
    {
      passive: true
    }
  );

  function finishSwipe() {
    if (!dragging) {
      return;
    }

    dragging = false;

    const distance =
      Math.max(
        0,
        currentY - startY
      );

    const elapsed =
      Math.max(
        Date.now() - startTime,
        1
      );

    const velocity =
      distance / elapsed;

    const shouldClose =
      distance >= 105 ||
      (
        distance >= 55 &&
        velocity >= 0.55
      );

    panel.classList.remove(
      "is-swipe-dragging"
    );

    if (shouldClose) {
      panel.classList.add(
        "is-swipe-closing"
      );

      panel.style.transform =
        "translateY(110%)";

      panel.style.opacity =
        "0";

      window.setTimeout(() => {
        closeLocationExplorer();

        panel.classList.remove(
          "is-swipe-closing"
        );

        panel.style.transform = "";
        panel.style.opacity = "";
      }, 220);

      return;
    }

    panel.style.transform = "";
    panel.style.opacity = "";
  }

  panel.addEventListener(
    "touchend",
    finishSwipe,
    {
      passive: true
    }
  );

  panel.addEventListener(
    "touchcancel",
    finishSwipe,
    {
      passive: true
    }
  );
}


document.addEventListener(
  "DOMContentLoaded",
  installLocationExplorerSwipeToClose
);

window.addEventListener(
  "pageshow",
  installLocationExplorerSwipeToClose
);


/* ==================================================
   ACTUALIZAR LA APP CUANDO CAMBIA EL DÍA
   ================================================== */

let alberoCurrentDateKey =
  toLocalISO(new Date());

let alberoDateRefreshInProgress =
  false;


function refreshAlberoTVIfDateChanged() {
  if (alberoDateRefreshInProgress) {
    return;
  }

  const newDateKey =
    toLocalISO(new Date());

  if (
    newDateKey === alberoCurrentDateKey
  ) {
    return;
  }

  alberoDateRefreshInProgress =
    true;

  console.log(
    `AlberoTV: cambio de fecha detectado, de ${
      alberoCurrentDateKey
    } a ${newDateKey}`
  );

  /*
   * Recargamos la interfaz completa para:
   * - volver a calcular HOY, AYER y MAÑANA;
   * - descargar la programación más reciente;
   * - centrar automáticamente el día actual;
   * - actualizar favoritos y avisos.
   */
  window.location.reload();
}


/*
 * Se ejecuta cuando la app vuelve
 * desde segundo plano.
 */
document.addEventListener(
  "visibilitychange",
  () => {
    if (
      document.visibilityState ===
      "visible"
    ) {
      window.setTimeout(
        refreshAlberoTVIfDateChanged,
        150
      );
    }
  }
);


/*
 * Refuerzo para Safari, PWA y WebView de iOS.
 */
window.addEventListener(
  "pageshow",
  () => {
    window.setTimeout(
      refreshAlberoTVIfDateChanged,
      150
    );
  }
);


/*
 * También detecta el cambio de día si la
 * aplicación permanece abierta a medianoche.
 */
window.setInterval(
  refreshAlberoTVIfDateChanged,
  60 * 1000
);


/* APP VIEWPORT HEIGHT FINAL */

function updateAlberoAppViewportHeight() {
  const mobileApp =
    window.matchMedia(
      "(max-width: 800px) and (hover: none)"
    ).matches;

  if (!mobileApp) {
    document.documentElement.style.removeProperty(
      "--albero-app-topbar-height"
    );

    return;
  }

  const topbar =
    document.querySelector(".topbar");

  if (!topbar) {
    return;
  }

  const topbarHeight =
    Math.ceil(
      topbar.getBoundingClientRect().height
    );

  document.documentElement.style.setProperty(
    "--albero-app-topbar-height",
    `${topbarHeight}px`
  );
}


function installAlberoAppViewportHeight() {
  updateAlberoAppViewportHeight();

  const topbar =
    document.querySelector(".topbar");

  if (
    topbar &&
    typeof ResizeObserver !== "undefined" &&
    !topbar.dataset.viewportObserverInstalled
  ) {
    topbar.dataset.viewportObserverInstalled =
      "true";

    const observer =
      new ResizeObserver(
        updateAlberoAppViewportHeight
      );

    observer.observe(topbar);
  }
}


if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    installAlberoAppViewportHeight
  );
} else {
  installAlberoAppViewportHeight();
}


window.addEventListener(
  "resize",
  updateAlberoAppViewportHeight
);

window.addEventListener(
  "orientationchange",
  () => {
    window.setTimeout(
      updateAlberoAppViewportHeight,
      200
    );
  }
);

window.addEventListener(
  "pageshow",
  installAlberoAppViewportHeight
);
