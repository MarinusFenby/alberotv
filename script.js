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

function centerCard(index, smooth = false) {
  const card = cards[index];

  if (!card) return;

  activeIndex = index;

  const left =
    card.offsetLeft -
    timeline.clientWidth / 2 +
    card.offsetWidth / 2;

  timeline.scrollTo({
    left: left,
    behavior: smooth
      ? 'smooth'
      : 'auto'
  });
}

function updateActive() {
  const center =
    timeline.getBoundingClientRect().left +
    timeline.clientWidth / 2;

  let bestIndex = 0;
  let minDistance = Infinity;

  cards.forEach((card, index) => {
    const rect =
      card.getBoundingClientRect();

    const cardCenter =
      rect.left +
      rect.width / 2;

    const distance =
      Math.abs(
        cardCenter -
        center
      );

    if (distance < minDistance) {
      minDistance = distance;
      bestIndex = index;
    }
  });

  activeIndex = bestIndex;

  cards.forEach(
    (card, index) => {

      card.classList.toggle(
        'active',
        index === activeIndex
      );

    }
  );
}

async function start() {

  let events = [];

  try {

    const response =
      await fetch(

        `data/onetoro.json?ts=${Date.now()}`,

        {
          cache:
            'no-store'
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

  for (
    let offset = -1;
    offset <= 14;
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

    card.innerHTML = `

      <div class="label">
        ${label}
      </div>

      <div class="date">
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

                  <div>

                    <h2>

                      ${
                        event.name ||
                        'Festejo taurino'
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

  requestAnimationFrame(
    () => {

      centerCard(
        activeIndex,
        false
      );

      setTimeout(
        updateActive,
        50
      );

    }
  );

}

timeline.addEventListener(

  'scroll',

  () => {

    requestAnimationFrame(
      updateActive
    );

  }

);

document
  .querySelector(
    '.left'
  )
  .onclick = () => {

    centerCard(

      Math.max(
        0,
        activeIndex - 1
      ),

      true

    );

  };

document
  .querySelector(
    '.right'
  )
  .onclick = () => {

    centerCard(

      Math.min(
        cards.length - 1,
        activeIndex + 1
      ),

      true

    );

  };

start();
