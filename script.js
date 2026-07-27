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


function buildBroadcastMarkup(event = {}) {
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
  const broadcast =
    getBroadcastPresentation(event);

  return `
    <div class="event-compact-header">
      <div class="event-header-information">
        <div class="event-topline">
          ${buildTimeMarkup(event)}
        </div>

        ${buildTemporalStatusMarkup(event)}

        ${
          broadcast.confirmed
            ? ""
            : `
              <div class="broadcast-unconfirmed-label">
                Sin emisión confirmada
              </div>
            `
        }
      </div>

      <div class="event-header-channel">
        ${buildBroadcastMarkup(event)}
      </div>
    </div>
  `;
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

  const locationLengthClass =
    getLocationLengthClass(location);

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

    </article>
  `;
}


/* ==================================================
   CREAR FESTEJO
   ================================================== */

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
    event.breeding ||
    "";

  const channel =
    event.channel ||
    "Canal por confirmar";

  const eventUrl =
    event.eventUrl ||
    event.sourceUrl ||
    "";

  return `
    <article class="event bullfighting-event">

      ${buildEventHeaderMarkup(event)}

      <div class="event-content-stack">

        <div class="event-type ${typeClass}">
          ${escapeHtml(type)}
        </div>

        <h2 class="event-title ${locationLengthClass}">
          ${escapeHtml(location)}
        </h2>

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

        ${
          breeding
            ? `
              <div class="breeding">
                ${escapeHtml(breeding)}
              </div>
            `
            : ""
        }

        ${
          eventUrl
            ? `
              <a
                class="event-link"
                href="${escapeHtml(eventUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Más información
              </a>
            `
            : ""
        }

      </div>

    </article>
  `;
}


/* ==================================================
   CREAR EVENTO SEGÚN SU CONTENIDO
   ================================================== */

function buildEvent(event) {
  if (isProgram(event)) {
    return buildProgram(event);
  }

  return buildBullfightingEvent(event);
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

  activeCard =
    closestCard;

  activeIndex =
    closestIndex;

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
      `data/programacion.json?ts=${Date.now()}`,
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

  return data.events || [];
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

  let events = [];

  try {
    events =
      await loadEvents();

    loadedEvents = events;

    console.log(
      `AlberoTV: ${events.length} elementos cargados`
    );

    renderCategoryNavigation(events);
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

  for (
    let offset = -5;
    offset <= 90;
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
      timeline.scrollLeft =
        todayCard.offsetLeft -
        timeline.clientWidth / 2 +
        todayCard.offsetWidth / 2;
    }

    updateVisuals();
    startTemporalStatusUpdates();
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

    const isHorizontalGesture =
      horizontalMovement >
      verticalMovement * 1.05;

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
    if (
      event.pointerType === "mouse" &&
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
