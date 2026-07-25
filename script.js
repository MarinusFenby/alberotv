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
let activeCard = null;
let activeIndex = 0;

let isDragging = false;
let dragStartX = 0;
let dragStartScrollLeft = 0;
let dragMoved = false;

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


/*
  Convierte un texto a minúsculas
  y elimina tildes.

  Esto permite reconocer de igual forma:

  "Corrida de toros"
  "CORRIDA DE TOROS"
  "corrida de toros"
*/

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}


/* ==================================================
   CLASIFICACIÓN DEL TIPO DE FESTEJO
   ================================================== */

function getTypeClass(type = "") {
  const normalizedType = normalizeText(type);

  /*
    El orden es importante.

    Por ejemplo, "corrida de rejones"
    contiene la palabra "corrida",
    pero debe clasificarse como rejones.
  */

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
   CREAR EVENTO
   ================================================== */

function buildEvent(event) {
  const time =
    event.time ||
    "Hora por confirmar";

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
    <article class="event">

      <div class="event-topline">

        <div class="time">
          ${escapeHtml(time)}
        </div>

        <div class="channel">
          ${escapeHtml(channel)}
        </div>

      </div>

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

    <div class="day-header">

      <div class="label">
        ${getDayLabel(offset)}
      </div>

      <div class="${dateClass}">
        ${date.getDate()}
        de
        ${months[date.getMonth()]}
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
                  No hay festejos televisados
                  publicados para este día.
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

   La tarjeta central nunca puede superar
   la altura disponible de la pantalla.
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

  /*
    Dejamos un margen de seguridad arriba y abajo
    para que la tarjeta nunca toque ni sobrepase
    los límites visibles.
  */

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

  /*
    En pantallas grandes puede crecer hasta 1.18.
    En pantallas bajas crecerá menos automáticamente.
  */

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
    const cardRect =
      card.getBoundingClientRect();

    /*
      Eliminamos el efecto de la escala anterior
      para calcular correctamente el centro real.

      offsetLeft representa la posición de la tarjeta
      dentro de la cinta antes de transformarla.
    */

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

    /*
      El tamaño central se calcula según
      la altura real disponible.

      De esta forma nunca queda cortado.
    */

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

    /*
      La tarjeta central queda verticalmente centrada.

      Los laterales bajan ligeramente,
      pero menos que antes para evitar cortes.
    */

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
    HOY se centra únicamente al abrir.
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

   Horizontal:
   mueve la cinta.

   Vertical:
   mueve únicamente el contenido
   del día situado en el centro.
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
        El navegador puede haber
        liberado ya el puntero.
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

   Recalcula el tamaño máximo de la tarjeta central.
   ================================================== */

window.addEventListener(
  "resize",
  requestVisualUpdate
);


/* ==================================================
   ARRANCAR
   ================================================== */

init();
