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
    "";

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

      </div>


      <div class="channel">
        ${escapeHtml(channel)}
      </div>

    </article>
  `;
}


/* ==================================================
   CREAR TARJETA DE DÍA
   ================================================== */

function buildDayCard(
  date,
  offset,
  events
) {
  const card =
    document.createElement(
      "article"
    );


  const dateKey =
    toLocalISO(date);


  card.className =
    "day";


  card.dataset.offset =
    String(offset);


  card.dataset.date =
    dateKey;


  const dayEvents =
    events.filter(
      event =>
        event.date ===
        dateKey
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
      ${date.getDate()}
      de
      ${months[date.getMonth()]}
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


  cards.forEach(
    card => {

      const rect =
        card.getBoundingClientRect();


      const cardCenter =
        rect.left +
        rect.width / 2;


      const signedDistance =
        cardCenter -
        center;


      const distance =
        Math.abs(
          signedDistance
        );


      const normalized =
        Math.min(

          distance /

          (
            timelineRect.width *
            0.55
          ),

          1

        );


      /*
        Centro = escala 1

        Cuanto más se aleja:
        se hace más pequeña.
      */

      const scale =
        1 -
        normalized *
        0.22;


      /*
        Cuanto más se aleja:
        pierde visibilidad.
      */

      const opacity =
        1 -
        normalized *
        0.62;


      const blur =
        normalized *
        1.2;


      /*
        El pasado queda
        algo más oscuro
        que el futuro.
      */

      const brightnessLoss =

        signedDistance < 0

          ? 0.42

          : 0.28;


      const brightness =

        1 -

        normalized *

        brightnessLoss;


      card.style.transform =
        `scale(${scale})`;


      card.style.opacity =
        String(opacity);


      card.style.filter =
        `
          blur(${blur}px)
          brightness(${brightness})
        `;


      /*
        La clase active solo
        cambia fondo y sombra.

        No mueve la cinta.
      */

      card.classList.toggle(

        "active",

        normalized <
          0.16

      );

    }
  );
}


/* ==================================================
   CARGAR PROGRAMACIÓN FUSIONADA
   ================================================== */

async function loadEvents() {

  const response =
    await fetch(

      `../data/programacion.json?ts=${Date.now()}`,

      {
        cache:
          "no-store"
      }

    );


  if (!response.ok) {

    throw new Error(

      `No se pudo cargar programacion.json: ${response.status}`

    );

  }


  const data =
    await response.json();


  return (
    data.events ||
    []
  );
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

    console.error(
      "Error cargando la programación:",
      error
    );

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
    Mostramos cinco días
    anteriores y 90 días futuros.

    Así podemos seguir navegando
    por la programación completa.
  */

  for (
    let offset = -5;
    offset <= 90;
    offset++
  ) {

    const date =
      new Date(
        today
      );


    date.setDate(

      today.getDate() +

      offset

    );


    const card =
      buildDayCard(

        date,

        offset,

        events

      );


    timeline.appendChild(
      card
    );

  }


  cards = [

    ...document.querySelectorAll(
      ".day"
    )

  ];


  /*
    Abrimos la web con HOY
    colocado aproximadamente
    en el centro.

    Solo ocurre una vez al cargar.
  */

  const todayCard =

    cards.find(

      card =>

        card.dataset.offset ===
        "0"

    );


  if (todayCard) {

    timeline.scrollLeft =

      todayCard.offsetLeft

      -

      timeline.clientWidth /
        2

      +

      todayCard.offsetWidth /
        2;

  }


  updateVisuals();
}


/* ==================================================
   SCROLL CONTINUO
   ================================================== */

let ticking =
  false;


timeline.addEventListener(

  "scroll",

  () => {

    hint?.classList.add(
      "hidden"
    );


    if (!ticking) {

      requestAnimationFrame(

        () => {

          updateVisuals();


          ticking =
            false;

        }

      );


      ticking =
        true;

    }

  }

);


/* ==================================================
   TRACKPAD / RUEDA
   ================================================== */

timeline.addEventListener(

  "wheel",

  event => {

    event.preventDefault();


    /*
      Soporta:

      - rueda tradicional
      - trackpad horizontal
      - trackpad vertical
    */

    const movement =

      Math.abs(event.deltaX) >
      Math.abs(event.deltaY)

        ? event.deltaX

        : event.deltaY;


    timeline.scrollLeft +=
      movement;

  },

  {
    passive:
      false
  }

);


/* ==================================================
   ARRASTRAR CON RATÓN
   ================================================== */

timeline.addEventListener(

  "pointerdown",

  event => {

    isDragging =
      true;


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

      dragStartScroll

      -

      movement;

  }

);


function stopDragging() {

  isDragging =
    false;


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

      /*
        Las flechas ya no saltan
        exactamente un día.

        Simplemente desplazan
        la cinta suavemente.
      */

      timeline.scrollBy({

        left:
          -420,

        behavior:
          "smooth"

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

        left:
          420,

        behavior:
          "smooth"

      });

    }

  );


/* ==================================================
   AJUSTE DE VENTANA
   ================================================== */

window.addEventListener(

  "resize",

  () => {

    updateVisuals();

  }

);


/* ==================================================
   ARRANCAR
   ================================================== */

init();
