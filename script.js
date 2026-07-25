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
let dragStartScrollLeft = 0;

let animationFrameRequested = false;


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
        (eventA, eventB) =>
          String(
            eventA.time || "99:99"
          ).localeCompare(
            String(
              eventB.time || "99:99"
            )
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
   EFECTO DE CINTA CONTINUA Y LUPA CENTRAL
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

  cards.forEach(card => {
    const cardRect =
      card.getBoundingClientRect();

    const cardCenter =
      cardRect.left +
      cardRect.width / 2;

    const signedDistance =
      cardCenter -
      viewportCenter;

    const absoluteDistance =
      Math.abs(signedDistance);

    /*
      Esta distancia define hasta dónde
      se aprecia el efecto de lupa.
    */

    const influenceDistance =
      Math.max(
        timelineRect.width * 0.58,
        1
      );

    const normalizedDistance =
      Math.min(
        absoluteDistance /
          influenceDistance,
        1
      );

    /*
      En el centro:
      escala = 1

      En los extremos:
      escala aproximada = 0,78
    */

    const scale =
      1 -
      normalizedDistance * 0.22;

    /*
      En el centro:
      opacidad = 1

      En los extremos:
      opacidad aproximada = 0,34
    */

    const opacity =
      1 -
      normalizedDistance * 0.66;

    const blur =
      normalizedDistance * 1.3;

    /*
      El pasado, a la izquierda,
      queda ligeramente más oscuro
      que el futuro.
    */

    const brightnessReduction =
      signedDistance < 0
        ? 0.43
        : 0.30;

    const brightness =
      1 -
      normalizedDistance *
        brightnessReduction;

    /*
      Elevamos ligeramente la tarjeta
      cuando se acerca al centro.
    */

    const lift =
      normalizedDistance * 8;

    card.style.transform =
      `translateY(${lift}px) scale(${scale})`;

    card.style.opacity =
      String(opacity);

    card.style.filter =
      `blur(${blur}px) brightness(${brightness})`;

    card.classList.toggle(
      "active",
      normalizedDistance < 0.15
    );
  });
}


function requestVisualUpdate() {
  if (animationFrameRequested) {
    return;
  }

  animationFrameRequested = true;

  requestAnimationFrame(() => {
    updateVisuals();

    animationFrameRequested = false;
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

  /*
    Cinco días anteriores
    y noventa días futuros.
  */

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

  /*
    HOY se centra únicamente
    al abrir la web.

    Después el movimiento queda
    completamente libre.
  */

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

   Vertical:
   desplaza la página normalmente.

   Horizontal:
   desplaza la cinta de días.

   Shift + rueda:
   desplaza horizontalmente.
   ================================================== */

timeline.addEventListener(
  "wheel",
  event => {
    const horizontalMovement =
      Math.abs(event.deltaX);

    const verticalMovement =
      Math.abs(event.deltaY);

    /*
      Trackpad horizontal real.
    */

    const isHorizontalGesture =
      horizontalMovement >
      verticalMovement * 1.15;

    /*
      Ratón convencional:
      Shift + rueda vertical
      desplaza la cinta.
    */

    const isShiftWheel =
      event.shiftKey &&
      verticalMovement > 0;

    if (
      !isHorizontalGesture &&
      !isShiftWheel
    ) {
      /*
        No hacemos preventDefault.

        El navegador puede mover
        la página arriba o abajo.
      */

      return;
    }

    event.preventDefault();

    const movement =
      isShiftWheel
        ? event.deltaY
        : event.deltaX;

    timeline.scrollLeft +=
      movement;

    requestVisualUpdate();
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
      Solo iniciamos el arrastre
      con el botón principal.
    */

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    isDragging = true;

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

  isDragging = false;

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
        No hacemos nada si el navegador
        ya liberó el puntero.
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


timeline.addEventListener(
  "pointerleave",
  event => {
    if (
      event.pointerType === "mouse"
    ) {
      stopDragging(event);
    }
  }
);


/* ==================================================
   FLECHAS

   Desplazan la cinta una distancia,
   pero no centran ninguna tarjeta.
   ================================================== */

document
  .querySelector(
    ".edge-arrow.left"
  )
  ?.addEventListener(
    "click",
    () => {
      timeline.scrollBy({
        left: -380,
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
        left: 380,
        behavior: "smooth"
      });
    }
  );


/* ==================================================
   AJUSTE DE VENTANA
   ================================================== */

window.addEventListener(
  "resize",
  requestVisualUpdate
);


/* ==================================================
   ARRANCAR
   ================================================== */

init();
