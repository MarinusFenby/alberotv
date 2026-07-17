
const timeline = document.querySelector('#timeline');

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

const week = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado'
];

let cards = [];
let activeIndex = 1;

function iso(date) {
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function updateVisuals() {
  const timelineRect =
    timeline.getBoundingClientRect();

  const center =
    timelineRect.left +
    timelineRect.width / 2;

  let closestIndex = 0;
  let closestDistance = Infinity;

  cards.forEach((card, index) => {
    const rect =
      card.getBoundingClientRect();

    const cardCenter =
      rect.left +
      rect.width / 2;

    const signedDistance =
      cardCenter - center;

    const distance =
      Math.abs(signedDistance);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }

    const normalized =
      Math.min(
        distance /
          Math.max(
            timelineRect.width * 0.52,
            1
          ),
        1
      );

    /*
      Cuanto más cerca esté una tarjeta
      del centro, más grande, clara y nítida.
    */

    const scale =
      1 - normalized * 0.16;

    const opacity =
      1 - normalized * 0.60;

    const blur =
      normalized * 1.2;

    /*
      Las tarjetas que quedan atrás
      aparecen algo más oscuras.
    */

    const brightnessLoss =
      signedDistance < 0
        ? 0.36
        : 0.24;

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
  });

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

function moveByOneDay(direction) {
  if (!cards.length) return;

  const nextIndex =
    Math.max(
      0,
      Math.min(
        cards.length - 1,
        activeIndex + direction
      )
    );

  const card =
    cards[nextIndex];

  const left =
    card.offsetLeft -
    timeline.clientWidth / 2 +
    card.offsetWidth / 2;

  timeline.scrollTo({
    left: left,
    behavior: 'smooth'
  });
}

async function start() {

  let events = [];

  try {

    const response =
      await fetch(
        `data/onetoro.json?ts=${Date.now()}`,
        {
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    events =
      data.events || [];

  } catch (error) {

    console.error(
      'No se pudo cargar la programación de OneToro',
      error
    );

  }

  const now =
    new Date();

  now.setHours(
    0,
    0,
    0,
    0
  );

  /*
    Generamos desde ayer hasta
    30 días en el futuro.
  */

  for (
    let offset = -1;
    offset <= 30;
    offset++
  ) {

    const d =
      new Date(now);

    d.setDate(
      now.getDate() +
      offset
    );

    const dateKey =
      iso(d);

    const dayEvents =
      events.filter(
        event =>
          event.date ===
          dateKey
      );

    const card =
      document.createElement(
        'article'
      );

    card.className =
      'day';

    card.dataset.offset =
      offset;

    const label =

      offset === -1
        ? 'AYER'

        : offset === 0
        ? 'HOY'

        : offset === 1
        ? 'MAÑANA'

        : '';

    /*
      Si es HOY añadimos
      la clase today-date.
    */

    const dateClass =
      offset === 0
        ? 'date today-date'
        : 'date';

    card.innerHTML = `

      <div class="label">
        ${label}
      </div>

      <div class="${dateClass}">
        ${d.getDate()}
        de
        ${months[d.getMonth()]}
      </div>

      <div class="weekday">
        ${week[d.getDay()]}
      </div>

      ${
        dayEvents.length

          ?

          dayEvents
            .map(
              event => `

                <div class="event">

                  <div class="time">

                    ${
                      event.time ||
                      'Hora por confirmar'
                    }

                  </div>

                  <div class="event-info">

                    <h2>

                      ${
                        (
                          event.name ||
                          'Festejo taurino'
                        ).replace(
                          /\s*\(\d{2}\/\d{2}\/\d{4}\)\s*$/,
                          ''
                        )
                      }

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
                      event.breeding

                        ?

                        `

                          <div class="breeding">

                            Ganadería:
                            ${event.breeding}

                          </div>

                        `

                        :

                        ''
                    }

                  </div>

                  <div class="channel">

                    ${
                      event.channel ||
                      'OneToro'
                    }

                  </div>

                </div>

              `
            )
            .join('')

          :

          `

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

  /*
    Colocamos HOY en el centro
    al cargar la página.
  */

  requestAnimationFrame(
    () => {

      const todayCard =
        cards[activeIndex];

      if (todayCard) {

        timeline.scrollLeft =

          todayCard.offsetLeft -

          timeline.clientWidth / 2 +

          todayCard.offsetWidth / 2;

      }

      updateVisuals();

    }
  );

}


/*
  Actualizamos tamaño, brillo y
  posición continuamente mientras
  desplazamos el carrusel.
*/

let ticking = false;

timeline.addEventListener(
  'scroll',
  () => {

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


/*
  Convierte la rueda vertical
  del ratón en desplazamiento
  horizontal continuo.
*/

timeline.addEventListener(
  'wheel',

  event => {

    if (
      Math.abs(event.deltaY) >
      Math.abs(event.deltaX)
    ) {

      event.preventDefault();

      timeline.scrollLeft +=
        event.deltaY;

    }

  },

  {
    passive: false
  }
);


/*
  Las flechas siguen permitiendo
  avanzar exactamente un día.
*/

document
  .querySelector('.left')
  .onclick = () => {

    moveByOneDay(-1);

  };


document
  .querySelector('.right')
  .onclick = () => {

    moveByOneDay(1);

  };


window.addEventListener(
  'resize',
  updateVisuals
);


start();
