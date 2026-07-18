const timeline = document.getElementById('timeline');
const hint = document.getElementById('hint');

const months = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre'
];

const weekdays = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado'
];

let cards = [];
let activeIndex = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartScroll = 0;

function toLocalISO(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function cleanEventName(name = '') {
  return name
    .replace(
      /\s*\(\d{2}\/\d{2}\/\d{4}\)\s*$/,
      ''
    )
    .trim();
}

function getDayLabel(offset) {
  if (offset === -1) return 'AYER';
  if (offset === 0) return 'HOY';
  if (offset === 1) return 'MAÑANA';

  return '';
}

function getEventTime(event) {
  return event.time || 'Hora por confirmar';
}

function getBreeding(event) {
  if (event.breeding) {
    return event.breeding;
  }

  return '';
}

function buildEvent(event) {
  const breeding =
    getBreeding(event);

  return `
    <article class="event">

      <div class="time">
        ${getEventTime(event)}
      </div>

      <div>

        <h2>
          ${cleanEventName(
            event.name ||
            'Festejo taurino'
          )}
        </h2>

        <div class="people">
          ${
            (
              event.participants ||
              []
            ).join(' · ')
          }
        </div>

        ${
          breeding
            ? `
              <div class="breeding">
                ${breeding}
              </div>
            `
            : ''
        }

      </div>

      <div class="channel">
        ${event.channel || 'OneToro'}
      </div>

    </article>
  `;
}

function buildDayCard(
  date,
  offset,
  events
) {
  const card =
    document.createElement(
      'article'
    );

  card.className =
    'day';

  card.dataset.offset =
    offset;

  card.dataset.date =
    toLocalISO(date);

  const dayLabel =
    getDayLabel(offset);

  const dateClass =
    offset === 0
      ? 'date today-date'
      : 'date';

  const dayEvents =
    events.filter(
      event =>
        event.date ===
        card.dataset.date
    );

  card.innerHTML = `

    <div class="label">
      ${dayLabel}
    </div>

    <div class="${dateClass}">
      ${date.getDate()}
      de
      ${months[date.getMonth()]}
    </div>

    <div class="weekday">
      ${weekdays[date.getDay()]}
    </div>

    ${
      dayEvents.length
        ? dayEvents
            .map(buildEvent)
            .join('')
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

  `;

  return card;
}

function updateVisuals() {
  if (!cards.length) {
    return;
  }

  const timelineRect =
    timeline.getBoundingClientRect();

  const center =
    timelineRect.left +
    timelineRect.width / 2;

  let closestIndex = 0;
  let closestDistance =
    Infinity;

  cards.forEach(
    (card, index) => {

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

      if (
        distance <
        closestDistance
      ) {

        closestDistance =
          distance;

        closestIndex =
          index;

      }

      const normalized =
        Math.min(
          distance /
          Math.max(
            timelineRect.width *
              0.55,
            1
          ),
          1
        );

      /*
        La transición es continua:
        no hay saltos de tarjeta.
      */

      const scale =
        1 -
        normalized *
          0.18;

      const opacity =
        1 -
        normalized *
          0.64;

      const blur =
        normalized *
          1.4;

      /*
        El pasado queda
        más oscuro que el futuro.
      */

      const brightnessLoss =
        signedDistance < 0
          ? 0.40
          : 0.26;

      const brightness =
        1 -
        normalized *
          brightnessLoss;

      card.style.transform =
        `scale(${scale})`;

      card.style.opacity =
        opacity;

      card.style.filter =
        `
          blur(${blur}px)
          brightness(${brightness})
        `;

    }
  );

  activeIndex =
    closestIndex;

  cards.forEach(
    (card, index) => {

      card.classList.toggle(
        'active',
        index === activeIndex
      );

    }
  );
}

function centerOnCard(
  index,
  smooth = true
) {
  const card =
    cards[index];

  if (!card) {
    return;
  }

  const targetLeft =

    card.offsetLeft

    -

    timeline.clientWidth /
      2

    +

    card.offsetWidth /
      2;

  timeline.scrollTo({

    left:
      targetLeft,

    behavior:
      smooth
        ? 'smooth'
        : 'auto'

  });
}

function moveOneDay(
  direction
) {
  const nextIndex =

    Math.max(

      0,

      Math.min(

        cards.length -
          1,

        activeIndex +
          direction

      )

    );

  centerOnCard(
    nextIndex,
    true
  );
}

async function loadEvents() {
  const response =
    await fetch(

      `../data/onetoro.json?ts=${Date.now()}`,

      {
        cache:
          'no-store'
      }

    );

  if (!response.ok) {

    throw new Error(
      `No se pudo cargar OneToro: ${response.status}`
    );

  }

  const data =
    await response.json();

  return (
    data.events ||
    []
  );
}

async function init() {
  let events = [];

  try {

    events =
      await loadEvents();

  } catch (error) {

    console.error(
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
    Mostramos ayer y
    los siguientes 45 días.
  */

  for (
    let offset = -1;
    offset <= 45;
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
      '.day'
    )

  ];

  const todayIndex =
    cards.findIndex(

      card =>
        card.dataset.offset ===
        '0'

    );

  activeIndex =

    todayIndex >= 0

      ? todayIndex

      : 0;

  requestAnimationFrame(
    () => {

      centerOnCard(
        activeIndex,
        false
      );

      updateVisuals();

    }
  );
}


/* ================================
   SCROLL CONTINUO
   ================================ */

let ticking = false;

timeline.addEventListener(

  'scroll',

  () => {

    hint?.classList.add(
      'hidden'
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


/*
  Trackpad y rueda:
  movimiento horizontal libre.
*/

timeline.addEventListener(

  'wheel',

  event => {

    if (

      Math.abs(
        event.deltaY
      )

      >

      Math.abs(
        event.deltaX
      )

    ) {

      event.preventDefault();

      timeline.scrollLeft +=
        event.deltaY;

    }

  },

  {
    passive:
      false
  }

);


/* ================================
   ARRASTRE CON RATÓN
   ================================ */

timeline.addEventListener(

  'pointerdown',

  event => {

    isDragging =
      true;

    dragStartX =
      event.clientX;

    dragStartScroll =
      timeline.scrollLeft;

    timeline.setPointerCapture(
      event.pointerId
    );

  }

);


timeline.addEventListener(

  'pointermove',

  event => {

    if (
      !isDragging
    ) {
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


timeline.addEventListener(

  'pointerup',

  event => {

    isDragging =
      false;

    try {

      timeline.releasePointerCapture(
        event.pointerId
      );

    } catch {

      /*
        No hacemos nada si
        el pointer ya fue liberado.
      */

    }

  }

);


timeline.addEventListener(

  'pointercancel',

  () => {

    isDragging =
      false;

  }

);


/* ================================
   FLECHAS
   ================================ */

document
  .querySelector(
    '.edge-arrow.left'
  )
  ?.addEventListener(

    'click',

    () => {

      moveOneDay(-1);

    }

  );


document
  .querySelector(
    '.edge-arrow.right'
  )
  ?.addEventListener(

    'click',

    () => {

      moveOneDay(1);

    }

  );


/* ================================
   TECLADO
   ================================ */

timeline.addEventListener(

  'keydown',

  event => {

    if (
      event.key ===
      'ArrowLeft'
    ) {

      moveOneDay(-1);

    }

    if (
      event.key ===
      'ArrowRight'
    ) {

      moveOneDay(1);

    }

  }

);


window.addEventListener(

  'resize',

  () => {

    updateVisuals();

  }

);


init();
