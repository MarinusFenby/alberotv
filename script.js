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


function getChannelLogoMarkup(channelName = "") {
  const normalized =
    normalizeText(channelName);

  if (
    normalized.includes("onetoro") ||
    normalized.includes("one toro")
  ) {
    return `
      <span class="channel-logo channel-logo-onetoro" role="img" aria-label="OneToro">
        <svg viewBox="0 0 132 34" aria-hidden="true">
          <rect x="1" y="1" width="130" height="32" rx="8"></rect>
          <path d="M18 22c3-7 8-10 14-10 5 0 9 2 12 6-4-2-7-2-10 0-2 1-4 4-5 7-4-2-8-3-11-3z"></path>
          <text x="50" y="22">ONE TORO</text>
        </svg>
      </span>
    `;
  }

  if (
    normalized.includes("canal sur") ||
    normalized === "csur"
  ) {
    return `
      <span class="channel-logo channel-logo-canalsur" role="img" aria-label="Canal Sur">
        <svg viewBox="0 0 128 34" aria-hidden="true">
          <rect x="1" y="1" width="126" height="32" rx="8"></rect>
          <circle cx="20" cy="17" r="7"></circle>
          <path d="M20 5v4M20 25v4M8 17h4M28 17h4M11.5 8.5l3 3M25.5 22.5l3 3M28.5 8.5l-3 3M14.5 22.5l-3 3"></path>
          <text x="38" y="22">CANAL SUR</text>
        </svg>
      </span>
    `;
  }

  if (
    normalized === "cmm" ||
    normalized.includes("castilla-la mancha") ||
    normalized.includes("castilla la mancha")
  ) {
    return `
      <span class="channel-logo channel-logo-cmm" role="img" aria-label="CMM">
        <svg viewBox="0 0 92 34" aria-hidden="true">
          <rect x="1" y="1" width="90" height="32" rx="8"></rect>
          <text x="15" y="23">CMM</text>
        </svg>
      </span>
    `;
  }

  if (
    normalized.includes("telemadrid") ||
    normalized.includes("tele madrid")
  ) {
    return `
      <span class="channel-logo channel-logo-telemadrid" role="img" aria-label="Telemadrid">
        <svg viewBox="0 0 136 34" aria-hidden="true">
          <rect x="1" y="1" width="134" height="32" rx="8"></rect>
          <path d="M20 8l2.5 6.2 6.5.5-5 4.2 1.6 6.4-5.6-3.5-5.6 3.5 1.6-6.4-5-4.2 6.5-.5z"></path>
          <text x="37" y="22">TELEMADRID</text>
        </svg>
      </span>
    `;
  }

  if (
    normalized.includes("aragon tv") ||
    normalized.includes("aragón tv") ||
    normalized === "atv"
  ) {
    return `
      <span class="channel-logo channel-logo-aragontv" role="img" aria-label="Aragón TV">
        <svg viewBox="0 0 120 34" aria-hidden="true">
          <rect x="1" y="1" width="118" height="32" rx="8"></rect>
          <path d="M12 24L22 8l10 16h-6l-4-7-4 7z"></path>
          <text x="39" y="22">ARAGÓN TV</text>
        </svg>
      </span>
    `;
  }

  if (
    normalized.includes("rtve") ||
    normalized.includes("la 2") ||
    normalized.includes("tve")
  ) {
    return `
      <span class="channel-logo channel-logo-rtve" role="img" aria-label="${escapeHtml(channelName)}">
        <svg viewBox="0 0 105 34" aria-hidden="true">
          <rect x="1" y="1" width="103" height="32" rx="8"></rect>
          <text x="14" y="22">${escapeHtml(channelName || "RTVE")}</text>
        </svg>
      </span>
    `;
  }

  return `
    <span class="channel-logo channel-logo-generic" role="img" aria-label="${escapeHtml(channelName)}">
      <span>${escapeHtml(channelName)}</span>
    </span>
  `;
}


function buildBroadcastMarkup(event = {}) {
  const broadcast =
    getBroadcastPresentation(event);

  if (!broadcast.confirmed) {
    return `
      <div class="broadcast-status broadcast-unconfirmed">
        <span class="broadcast-muted-dot" aria-hidden="true"></span>
        <span>${escapeHtml(broadcast.label)}</span>
      </div>
    `;
  }

  return `
    <div class="broadcast-status broadcast-confirmed">
      ${getChannelLogoMarkup(broadcast.label)}
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
    .event-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      max-width: 100%;
      margin: 9px 0 5px;
      padding: 7px 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.065);
      font-size: 0.69rem;
      font-weight: 850;
      line-height: 1;
      letter-spacing: 0.045em;
      white-space: nowrap;
    }

    .event-status-light {
      width: 8px;
      height: 8px;
      flex: 0 0 8px;
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
      color: rgba(255, 255, 255, 0.72);
    }

    .event-status-starting-soon {
      color: #ffb052;
      border-color: rgba(255, 176, 82, 0.28);
      background: rgba(255, 176, 82, 0.09);
    }

    .event-status-live {
      color: #ff595f;
      border-color: rgba(255, 89, 95, 0.4);
      background: rgba(255, 89, 95, 0.12);
    }

    .event-status-live .event-status-light {
      animation: alberotv-live-light 1.25s ease-in-out infinite;
    }

    .event-status-finished {
      color: rgba(255, 255, 255, 0.42);
      background: rgba(255, 255, 255, 0.035);
    }

    .broadcast-status {
      display: flex;
      align-items: center;
      width: fit-content;
      min-height: 28px;
      margin: 5px 0 7px;
    }

    .broadcast-unconfirmed {
      gap: 7px;
      color: rgba(255, 255, 255, 0.42);
      font-size: 0.69rem;
      font-weight: 650;
      letter-spacing: 0.01em;
    }

    .broadcast-muted-dot {
      width: 5px;
      height: 5px;
      flex: 0 0 5px;
      border-radius: 50%;
      background: currentColor;
    }

    .channel-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 27px;
      max-width: 145px;
      overflow: hidden;
      border-radius: 8px;
    }

    .channel-logo svg {
      display: block;
      width: auto;
      height: 27px;
      overflow: visible;
    }

    .channel-logo svg rect {
      fill: rgba(255, 255, 255, 0.94);
      stroke: rgba(255, 255, 255, 0.12);
    }

    .channel-logo svg text {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.35px;
      dominant-baseline: middle;
      fill: #10233f;
    }

    .channel-logo-onetoro svg path {
      fill: #d41225;
    }

    .channel-logo-canalsur svg circle {
      fill: none;
      stroke: #0b8f55;
      stroke-width: 2.2;
    }

    .channel-logo-canalsur svg path {
      fill: none;
      stroke: #0b8f55;
      stroke-width: 1.6;
      stroke-linecap: round;
    }

    .channel-logo-cmm svg rect {
      fill: #ef2f4f;
    }

    .channel-logo-cmm svg text {
      fill: #ffffff;
      font-size: 16px;
      letter-spacing: 1px;
    }

    .channel-logo-telemadrid svg path {
      fill: #1c8bd1;
    }

    .channel-logo-aragontv svg path {
      fill: #e8a300;
    }

    .channel-logo-rtve svg rect {
      fill: #1e74bb;
    }

    .channel-logo-rtve svg text {
      fill: #ffffff;
      font-size: 12px;
    }

    .channel-logo-generic {
      min-height: 27px;
      padding: 0 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.84);
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.025em;
      white-space: nowrap;
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

    @media (max-width: 800px) {
      .event-status {
        margin-top: 7px;
        padding: 6px 8px;
        font-size: 0.62rem;
        letter-spacing: 0.035em;
      }

      .channel-logo,
      .channel-logo svg {
        height: 25px;
      }

      .broadcast-status {
        min-height: 25px;
      }

      .broadcast-unconfirmed {
        font-size: 0.64rem;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .event-status-live .event-status-light {
        animation: none;
        box-shadow: 0 0 7px 2px rgba(255, 89, 95, 0.35);
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

      <div class="event-topline program-topline">

        ${buildTimeMarkup(event)}

      </div>

      ${buildTemporalStatusMarkup(event)}
      ${buildBroadcastMarkup(event)}

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

      <div class="event-topline">

        ${buildTimeMarkup(event)}

      </div>

      ${buildTemporalStatusMarkup(event)}
      ${buildBroadcastMarkup(event)}

      <div class="event-type ${typeClass}">
        ${escapeHtml(type)}
      </div>

      <h2 class="event-title">
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
