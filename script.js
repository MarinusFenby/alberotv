const timeline = document.getElementById("timeline");
const hint = document.getElementById("hint");

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
let isDragging = false;
let dragStartX = 0;
let dragStartScroll = 0;


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
  if (offset === -1) return "AYER";
  if (offset === 0) return "HOY";
  if (offset === 1) return "MAÑANA";

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


/* ==================================================
   CREAR EVENTO
   ================================================== */

function buildEvent(event) {
  const time =
    event.time ||
    "Hora por confirmar";

  const type =
    event.type ||
    "Festejo taurino";

  const location =
    event.location ||
    event.name ||
    "Localidad por confirmar";

  const participants =
    formatParticipants(
      event.participants ||
      []
    );

  const breeding =
    event.breeding ||
    "";

  const channel =
    event.channel ||
    "Canal por confirmar";

  const eventUrl =
    event.eventUrl ||
    "";

  return `
    <article class="event">

      <div class="time">
        ${escapeHtml(time)}
      </div>

      <div class="event-content">

        <div class="event-type">
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
                Ver emisión
              </a>
            `
            : ""
        }

      </div>

      <div class="channel">
        ${escapeHtml(channel)}
      </div>

    </article>
  `;
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
    "day";

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
        (a, b) =>
          String(a.time || "99:99")
            .localeCompare(
              String(b.time || "99:99")
            )
      );

  const dateClass =
    offset === 0
      ? "date today-date"
      : "date";

  card.innerHTML = `

    <div class="label">
      ${getDayLabel(offset)}
    </div>

    <div class="${dateClass}">
      ${date.getDate()} de ${months[date.getMonth()]}
    </div>

    <div class="weekday">
      ${weekdays[date.getDay()]}
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

                <br>

                No hay festejos publicados
                para este día.

              </div>
            `
      }

    </div>

  `;

  return card;
}


/* ==================================================
   EFECTO LUPA CENTRAL
   ================================================== */

function updateVisuals() {
  if (!cards.length) {
    return;
  }

  const timelineRect =
    timeline.getBoundingClientRect();

  const center =
    timelineRect.left +
    timelineRect.width / 2;

  cards.forEach(card => {
    const rect =
      card.getBoundingClientRect();

    const cardCenter =
      rect.left +
      rect.width / 2;

    const signedDistance =
      cardCenter - center;

    const distance =
      Math.abs(signedDistance);

    const normalized =
      Math.min(
        distance /
          Math.max(
            timelineRect.width * 0.55,
            1
          ),
        1
      );

    const scale =
      1 -
      normalized * 0.22;

    const opacity =
      1 -
      normalized * 0.62;

    const blur =
      normalized * 1.2;

    const brightnessLoss =
      signedDistance < 0
        ? 0.42
        : 0.28;

    const brightness =
      1 -
      normalized * brightnessLoss;

    card.style.transform =
      `scale(${scale})`;

    card.style.opacity =
      String(opacity);

    card.style.filter =
      `blur(${blur}px) brightness(${brightness})`;

    card.classList.toggle(
      "active",
      normalized < 0.16
    );
  });
}


/* ==================================================
   CARGAR PROGRAMACIÓN

   La web está ahora en la raíz,
   por eso la ruta correcta es:
   data/programacion.json
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
   MOSTRAR ERROR EN LA WEB
   ================================================== */

function showLoadingError(error) {
  console.error(
    "Error cargando la programación:",
    error
  );

  timeline.innerHTML = `
    <article class="day active">

      <div class="label">
        ERROR
      </div>

      <div class="date">
        Programación no disponible
      </div>

      <div class="weekday">
        No se ha podido cargar programacion.json
      </div>

      <div class="empty">
        Revisa la actualización automática de AlberoTV.
      </div>

    </article>
  `;
}


/* ==================================================
   INICIAR WEB
   ================================================== */

async function init() {
  let events = [];

  try {
    events =
      await loadEvents();

    console.log(
      `AlberoTV: ${events.length} eventos cargados`
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
    ...document.querySelectorAll(".day")
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
  });
}


/* ==================================================
   SCROLL CONTINUO
   ================================================== */

let ticking = false;

timeline.addEventListener(
  "scroll",
  () => {
    hint?.classList.add(
      "hidden"
    );

    if (!ticking) {
      requestAnimationFrame(() => {
        updateVisuals();
        ticking = false;
      });

      ticking = true;
    }
  }
);


/* ==================================================
   TRACKPAD Y RUEDA
   ================================================== */

timeline.addEventListener(
  "wheel",
  event => {
    event.preventDefault();

    const movement =
      Math.abs(event.deltaX) >
      Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;

    timeline.scrollLeft +=
      movement;
  },
  {
    passive: false
  }
);


/* ==================================================
   ARRASTRAR CON EL RATÓN
   ================================================== */

timeline.addEventListener(
  "pointerdown",
  event => {
    isDragging = true;

    dragStartX =
      event.clientX;

    dragStartScroll =
      timeline.scrollLeft;

    timeline.style.cursor =
      "grabbing";

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

    timeline.scrollLeft =
      dragStartScroll -
      movement;
  }
);


function stopDragging() {
  isDragging = false;

  timeline.style.cursor =
    "grab";
}


timeline.addEventListener(
  "pointerup",
  stopDragging
);


timeline.addEventListener(
  "pointercancel",
  stopDragging
);


window.addEventListener(
  "pointerup",
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
        left: -420,
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
        left: 420,
        behavior: "smooth"
      });
    }
  );


window.addEventListener(
  "resize",
  updateVisuals
);


init();
