const timeline = document.getElementById("timeline");
const hint = document.getElementById("hint");

const SPANISH_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const SPANISH_WEEKDAYS = [
  "Domingo", "Lunes", "Martes", "Miércoles",
  "Jueves", "Viernes", "Sábado"
];

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function parseISODateLocal(iso) {
  const [y, m, d] = iso.split("-").map(Number);

  return new Date(y, m - 1, d);
}

function formatDate(date) {
  return `${date.getDate()} de ${SPANISH_MONTHS[date.getMonth()]}`;
}

function dayLabel(date, today) {
  const diff = Math.round(
    (date - today) / 86400000
  );

  if (diff === -1) return "AYER";
  if (diff === 0) return "HOY";
  if (diff === 1) return "MAÑANA";

  if (diff < -1) return "ANTERIOR";

  return "PRÓXIMO";
}

function statusForEvent(eventDate, today) {
  const diff = Math.round(
    (eventDate - today) / 86400000
  );

  if (diff < 0) return "Finalizado";
  if (diff === 0) return "Hoy";

  return "Próximo";
}

function categoryFromParticipants(participants = []) {

  const joined = participants
    .join(" ")
    .toLowerCase();

  if (joined.includes("novillada")) {
    return "Novillada";
  }

  if (
    joined.includes("rejones") ||
    joined.includes("rejoneo")
  ) {
    return "Rejones";
  }

  return "Festejo taurino";
}

function cleanEventName(name = "") {

  return name
    .replace(
      /\s*\(\d{2}\/\d{2}\/\d{4}\)\s*$/,
      ""
    )
    .trim();
}

function transformOneToroEvent(event, today) {

  const date = parseISODateLocal(event.date);

  return {

    time:
      event.time ||
      "Hora por confirmar",

    category:
      categoryFromParticipants(
        event.participants
      ),

    title:
      cleanEventName(event.name),

    venue:
      cleanEventName(event.name),

    lineup:
      (event.participants || [])
        .join(" · ") ||
      "Información por confirmar",

    breeding: "",

    channel:
      event.channel ||
      "OneToro",

    status:
      statusForEvent(
        date,
        today
      ),

    image:
      event.image ||
      null,

    sourceUrl:
      event.sourceUrl ||
      null
  };
}

function buildDays(events) {

  const now = new Date();

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const byDate = new Map();

  for (const event of events) {

    if (!event?.date) {
      continue;
    }

    if (!byDate.has(event.date)) {
      byDate.set(
        event.date,
        []
      );
    }

    byDate
      .get(event.date)
      .push(
        transformOneToroEvent(
          event,
          today
        )
      );
  }

  /*
   * Siempre mostramos:
   *
   * AYER
   * HOY
   * MAÑANA
   *
   * aunque no haya emisiones.
   */

  const requiredDates =
    [-1, 0, 1].map(
      offset => {

        const d =
          new Date(today);

        d.setDate(
          today.getDate() +
          offset
        );

        return localDateKey(d);
      }
    );

  /*
   * Añadimos también todos
   * los próximos días para los
   * que OneToro tenga programación.
   */

  const allKeys = [
    ...new Set([
      ...requiredDates,
      ...byDate.keys()
    ])
  ].sort();

  return allKeys.map(
    key => {

      const date =
        parseISODateLocal(key);

      return {

        key,

        label:
          dayLabel(
            date,
            today
          ),

        date:
          formatDate(date),

        weekday:
          SPANISH_WEEKDAYS[
            date.getDay()
          ],

        events:
          byDate.get(key) ||
          []
      };
    }
  );
}

function renderDay(day, index) {

  const article =
    document.createElement(
      "article"
    );

  article.className = "day";

  article.dataset.index =
    index;

  article.dataset.date =
    day.key;

  const eventsHtml =
    day.events.length

      ? day.events
          .map(
            event => `

              <article class="event">

                <div class="event-time">
                  ${event.time}
                </div>

                <div>

                  <span class="badge">
                    ${event.category.toUpperCase()}
                  </span>

                  <h3 class="event-title">
                    ${event.title}
                  </h3>

                  ${
                    event.venue
                      ? `
                        <p class="venue">
                          ${event.venue}
                        </p>
                      `
                      : ""
                  }

                  ${
                    event.lineup
                      ? `
                        <p class="lineup">
                          ${event.lineup}
                        </p>
                      `
                      : ""
                  }

                  ${
                    event.breeding
                      ? `
                        <p class="breeding">
                          ${event.breeding}
                        </p>
                      `
                      : ""
                  }

                  ${
                    event.sourceUrl
                      ? `
                        <a
                          class="event-link"
                          href="${event.sourceUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ver en OneToro
                        </a>
                      `
                      : ""
                  }

                </div>

                <div class="channel">

                  ${event.channel}

                  <small>
                    ${event.status.toUpperCase()}
                  </small>

                </div>

              </article>

            `
          )
          .join("")

      : `

        <div class="empty-day">

          <strong>
            Sin emisiones programadas
          </strong>

          <span>
            No hay festejos publicados
            para este día.
          </span>

        </div>

      `;

  article.innerHTML = `

    <header class="day-header">

      <div class="day-kicker">
        ${day.label}
      </div>

      <h2 class="day-date">
        ${day.date}
      </h2>

      <div class="day-weekday">
        ${day.weekday}
      </div>

    </header>

    <div class="events">
      ${eventsHtml}
    </div>

  `;

  return article;
}

let cards = [];

let activeIndex = 0;

function centerCard(
  index,
  smooth = true
) {

  const card =
    cards[index];

  if (!card) {
    return;
  }

  activeIndex =
    index;

  const targetLeft =

    card.offsetLeft

    - (
      timeline.clientWidth /
      2
    )

    + (
      card.offsetWidth /
      2
    );

  timeline.scrollTo({

    left:
      targetLeft,

    behavior:
      smooth
        ? "smooth"
        : "auto"

  });
}

function updateVisuals() {

  const center =

    timeline
      .getBoundingClientRect()
      .left

    +

    timeline.clientWidth /
    2;

  cards.forEach(
    (card, index) => {

      const rect =
        card.getBoundingClientRect();

      const cardCenter =

        rect.left

        +

        rect.width /
        2;

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
            timeline.clientWidth *
            0.65
          ),

          1

        );

      const scale =

        1

        -

        normalized *
        0.16;

      const opacity =

        1

        -

        normalized *
        0.52;

      const blur =

        normalized *
        1.8;

      /*
       * El pasado queda
       * algo más oscuro.
       *
       * El futuro queda
       * ligeramente menos apagado.
       */

      const sideDarkening =

        signedDistance < 0

          ? 0.40

          : 0.28;

      const brightness =

        1

        -

        normalized *
        sideDarkening;

      card.style.transform =

        `scale(${scale})`;

      card.style.opacity =

        opacity;

      card.style.filter =

        `blur(${blur}px) brightness(${brightness})`;

      if (
        distance <
        rect.width *
        0.28
      ) {

        activeIndex =
          index;

        card.classList.add(
          "is-active"
        );

      } else {

        card.classList.remove(
          "is-active"
        );

      }

    }
  );
}

function setupInteractions() {

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

  /*
   * Convierte la rueda vertical
   * del ratón en scroll horizontal.
   */

  timeline.addEventListener(

    "wheel",

    e => {

      if (
        Math.abs(e.deltaY) >
        Math.abs(e.deltaX)
      ) {

        e.preventDefault();

        timeline.scrollLeft +=
          e.deltaY;

      }

    },

    {
      passive: false
    }

  );

  document
    .querySelector(
      ".edge-arrow.left"
    )
    ?.addEventListener(
      "click",
      () => {

        centerCard(

          Math.max(
            0,
            activeIndex - 1
          )

        );

      }
    );

  document
    .querySelector(
      ".edge-arrow.right"
    )
    ?.addEventListener(
      "click",
      () => {

        centerCard(

          Math.min(
            cards.length - 1,
            activeIndex + 1
          )

        );

      }
    );

  timeline.addEventListener(
    "keydown",
    e => {

      if (
        e.key ===
        "ArrowLeft"
      ) {

        centerCard(

          Math.max(
            0,
            activeIndex - 1
          )

        );

      }

      if (
        e.key ===
        "ArrowRight"
      ) {

        centerCard(

          Math.min(
            cards.length - 1,
            activeIndex + 1
          )

        );

      }

    }
  );

  /*
   * Permite arrastrar
   * la programación con
   * el ratón o el dedo.
   */

  let isDragging =
    false;

  let startX =
    0;

  let startScroll =
    0;

  timeline.addEventListener(

    "pointerdown",

    e => {

      isDragging =
        true;

      startX =
        e.clientX;

      startScroll =
        timeline.scrollLeft;

      timeline.setPointerCapture(
        e.pointerId
      );

    }

  );

  timeline.addEventListener(

    "pointermove",

    e => {

      if (!isDragging) {
        return;
      }

      timeline.scrollLeft =

        startScroll

        -

        (
          e.clientX -
          startX
        );

    }

  );

  timeline.addEventListener(

    "pointerup",

    () => {

      isDragging =
        false;

      centerCard(
        activeIndex
      );

    }

  );

  window.addEventListener(

    "resize",

    updateVisuals

  );
}

async function loadSchedule() {

  try {

    /*
     * Cargamos el JSON generado
     * automáticamente por el
     * extractor de OneToro.
     */

    const response =
      await fetch(

        `data/onetoro.json?v=${Date.now()}`,

        {
          cache:
            "no-store"
        }

      );

    if (!response.ok) {

      throw new Error(

        `No se pudo cargar OneToro (${response.status})`

      );

    }

    const data =
      await response.json();

    const days =
      buildDays(
        data.events ||
        []
      );

    timeline.innerHTML =
      "";

    days.forEach(

      (day, i) =>

        timeline.appendChild(

          renderDay(
            day,
            i
          )

        )

    );

    cards = [

      ...document.querySelectorAll(
        ".day"
      )

    ];

    /*
     * Al abrir la web buscamos
     * automáticamente HOY y lo
     * colocamos en el centro.
     */

    const todayKey =
      localDateKey(
        new Date()
      );

    activeIndex =

      Math.max(

        0,

        cards.findIndex(

          card =>

            card.dataset.date ===
            todayKey

        )

      );

    requestAnimationFrame(
      () => {

        centerCard(
          activeIndex,
          false
        );

        setTimeout(
          updateVisuals,
          40
        );

      }
    );

  } catch (error) {

    console.error(
      error
    );

    timeline.innerHTML = `

      <article
        class="day is-active"
      >

        <header
          class="day-header"
        >

          <div
            class="day-kicker"
          >
            ERROR
          </div>

          <h2
            class="day-date"
          >
            Programación no disponible
          </h2>

          <div
            class="day-weekday"
          >
            No se han podido cargar
            los datos de OneToro.
          </div>

        </header>

      </article>

    `;

  }

}

setupInteractions();

loadSchedule();
