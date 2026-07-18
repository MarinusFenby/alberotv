const timeline = document.getElementById('timeline');
const hint = document.getElementById('hint');

const months = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre'
];

const weekdays = [
  'Domingo','Lunes','Martes','Miércoles',
  'Jueves','Viernes','Sábado'
];

let cards = [];
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
    .replace(/\s*\(\d{2}\/\d{2}\/\d{4}\)\s*$/, '')
    .trim();
}

function getDayLabel(offset) {
  if (offset === -1) return 'AYER';
  if (offset === 0) return 'HOY';
  if (offset === 1) return 'MAÑANA';
  return '';
}

function buildEvent(event) {
  return `
    <article class="event">

      <div class="time">
        ${event.time || 'Hora por confirmar'}
      </div>

      <div>

        <h2>
          ${cleanEventName(event.name || 'Festejo taurino')}
        </h2>

        <div class="people">
          ${(event.participants || []).join(' · ')}
        </div>

        ${
          event.breeding
            ? `<div class="breeding">${event.breeding}</div>`
            : ''
        }

      </div>

      <div class="channel">
        ${event.channel || 'OneToro'}
      </div>

    </article>
  `;
}

function buildDayCard(date, offset, events) {
  const card = document.createElement('article');

  card.className = 'day';
  card.dataset.offset = offset;
  card.dataset.date = toLocalISO(date);

  const dayEvents = events.filter(
    event => event.date === card.dataset.date
  );

  const dateClass =
    offset === 0
      ? 'date today-date'
      : 'date';

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

    ${
      dayEvents.length
        ? dayEvents.map(buildEvent).join('')
        : `
          <div class="empty">
            <b>Sin emisiones programadas</b><br>
            No hay festejos publicados para este día.
          </div>
        `
    }

  `;

  return card;
}

function updateVisuals() {
  if (!cards.length) return;

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
        (timelineRect.width * 0.55),
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
      normalized *
      brightnessLoss;

    card.style.transform =
      `scale(${scale})`;

    card.style.opacity =
      opacity;

    card.style.filter =
      `blur(${blur}px) brightness(${brightness})`;

    card.classList.toggle(
      'active',
      normalized < 0.16
    );
  });
}

async function loadEvents() {
  const response =
    await fetch(
      `../data/onetoro.json?ts=${Date.now()}`,
      {
        cache: 'no-store'
      }
    );

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar OneToro: ${response.status}`
    );
  }

  const data =
    await response.json();

  return data.events || [];
}

async function init() {
  let events = [];

  try {
    events =
      await loadEvents();
  } catch (error) {
    console.error(error);
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
    offset <= 45;
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
    ...document.querySelectorAll('.day')
  ];

  const todayCard =
    cards.find(
      card =>
        card.dataset.offset === '0'
    );

  if (todayCard) {
    timeline.scrollLeft =
      todayCard.offsetLeft -
      timeline.clientWidth / 2 +
      todayCard.offsetWidth / 2;
  }

  updateVisuals();
}

let ticking = false;

timeline.addEventListener(
  'scroll',
  () => {

    hint?.classList.add('hidden');

    if (!ticking) {

      requestAnimationFrame(
        () => {
          updateVisuals();
          ticking = false;
        }
      );

      ticking = true;
    }

  }
);


/* rueda del ratón -> scroll horizontal continuo */

timeline.addEventListener(
  'wheel',
  event => {

    event.preventDefault();

    timeline.scrollLeft +=
      event.deltaY +
      event.deltaX;

  },
  {
    passive: false
  }
);


/* arrastre completamente libre */

timeline.addEventListener(
  'pointerdown',
  event => {

    isDragging = true;

    dragStartX =
      event.clientX;

    dragStartScroll =
      timeline.scrollLeft;

    timeline.style.cursor =
      'grabbing';

  }
);

timeline.addEventListener(
  'pointermove',
  event => {

    if (!isDragging) return;

    const movement =
      event.clientX -
      dragStartX;

    timeline.scrollLeft =
      dragStartScroll -
      movement;

  }
);

window.addEventListener(
  'pointerup',
  () => {

    isDragging = false;

    timeline.style.cursor =
      'grab';

  }
);


/* Flechas: desplazan la cinta, no saltan de día */

document
  .querySelector('.edge-arrow.left')
  ?.addEventListener(
    'click',
    () => {

      timeline.scrollBy({
        left: -420,
        behavior: 'smooth'
      });

    }
  );

document
  .querySelector('.edge-arrow.right')
  ?.addEventListener(
    'click',
    () => {

      timeline.scrollBy({
        left: 420,
        behavior: 'smooth'
      });

    }
  );


window.addEventListener(
  'resize',
  updateVisuals
);

init();
