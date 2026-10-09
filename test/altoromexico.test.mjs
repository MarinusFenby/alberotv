import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCarteleria, mexicoTimeZone, parseCattle, parsePlace } from "../scrapers/altoromexico.mjs";
import { mergeTwoEvents, localSchedule } from "../scrapers/merge.mjs";

// Cartelera real de Al Toro México del 09/10/2026 (ISO-8859-1).
const html = new TextDecoder("latin1").decode(
  fs.readFileSync(new URL("./fixtures/altoromexico-carteleria-2026-10-09.html", import.meta.url)));
const events = parseCarteleria(html, { fetchedAt: "2026-10-09T08:30:00.000Z" });
const find = (date, town) => events.find(event => event.date === date && event.location.startsWith(town));

// Instante UTC de una hora civil en una zona (misma regla que la app).
function utc(date, time, zone) {
  const target = Date.parse(`${date}T${time}:00Z`);
  const wall = instant => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  };
  let instant = target;
  for (let i = 0; i < 4; i++) instant += target - wall(instant);
  return new Date(instant).toISOString();
}
const madrid = iso => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" })
  .format(new Date(iso));

test("la cartelera completa: 42 festejos con fecha, hora local, plaza, cartel y ganadería", () => {
  assert.equal(events.length, 42);
  assert.ok(events.every(event => event.sourceLocalDate && event.sourceLocalTime && event.sourceTimeZone));
  assert.ok(events.every(event => event.time === null && event.country === "México"));
  const pachuca = find("2026-10-10", "Pachuca");
  assert.deepEqual(pachuca.participants, ["Uriel Moreno El Zapata", "Luis Gallardo", "Juan Pablo Sánchez"]);
  assert.equal(pachuca.breeding, "José Julián Llaguno");
  assert.equal(pachuca.cattleCount, 6);
  assert.equal(pachuca.type, "Corrida de toros");
});

test("Reynosa 10/10 17:30: America/Matamoros (horario de verano fronterizo), 00:30 del 11/10 en Madrid", () => {
  const reynosa = find("2026-10-10", "Reynosa");
  assert.equal(reynosa.location, "Reynosa (Tamaulipas) México");
  assert.deepEqual(localSchedule(reynosa),
    { sourceLocalDate: "2026-10-10", sourceLocalTime: "17:30", sourceTimeZone: "America/Matamoros" });
  assert.equal(utc("2026-10-10", "17:30", "America/Matamoros"), "2026-10-10T22:30:00.000Z");
  assert.equal(madrid(utc("2026-10-10", "17:30", "America/Matamoros")), "11/10/26, 0:30");
  // Con la zona del centro (error típico) saldría una hora más tarde.
  assert.notEqual(utc("2026-10-10", "17:30", "America/Mexico_City"), "2026-10-10T22:30:00.000Z");
});

test("zona centro: Guadalajara 16/10 20:30 → 02:30 UTC del 17/10", () => {
  const guadalajara = find("2026-10-16", "Guadalajara");
  assert.equal(guadalajara.sourceTimeZone, "America/Mexico_City");
  assert.equal(utc("2026-10-16", "20:30", "America/Mexico_City"), "2026-10-17T02:30:00.000Z");
  assert.equal(mexicoTimeZone("Ciudad de México", "CDMX"), "America/Mexico_City");
  assert.equal(mexicoTimeZone("Cinco Villas", "Estado de México"), "America/Mexico_City");
});

test("zonas por estado y municipio, nunca una sola para México", () => {
  assert.equal(mexicoTimeZone("Monterrey", "Nuevo León"), "America/Monterrey");
  assert.equal(mexicoTimeZone("Cadereyta", "Nuevo León"), "America/Monterrey");
  assert.equal(mexicoTimeZone("Ciudad Lerdo", "Durango"), "America/Monterrey");
  assert.equal(mexicoTimeZone("Xmatkuil", "Yucatán"), "America/Merida");
  assert.equal(mexicoTimeZone("Nuevo Laredo", "Tamaulipas"), "America/Matamoros");
  assert.equal(mexicoTimeZone("Tampico", "Tamaulipas"), "America/Monterrey");
  assert.equal(mexicoTimeZone("Ciudad Juárez", "Chihuahua"), "America/Ciudad_Juarez");
  assert.equal(mexicoTimeZone("Tijuana", "Baja California"), "America/Tijuana");
  assert.equal(mexicoTimeZone("Cancún", "Quintana Roo"), "America/Cancun");
  assert.equal(mexicoTimeZone("Aguascalientes", "Ags"), "America/Mexico_City");
});

test("zona incierta: la hora queda para revisión, sin horario publicable", () => {
  assert.equal(mexicoTimeZone("Algún pueblo", ""), null);
  assert.equal(mexicoTimeZone("Algún pueblo", "Estado inventado"), null);
  const card = `<div class="fecha-festejo"><div><strong>Sábado, 14 Nov 2026 , </strong> 17:00 horas</div></div>
    <div class="row"><div><img src="x.jpg"/><br> 6 Ganadería X 6 <div class="lugar-festejo">Rancho Nuevo</div><hr>
    <div><div style="font-size:15px; font-weight:700; margin-bottom:25px">Corrida de toros </div></div></div>
    <div class="torero">Torero Uno </div></div>`;
  const [event] = parseCarteleria(card);
  assert.equal(localSchedule(event), null);
  assert.equal(event.sourceLocalTime, undefined);
  assert.deepEqual(event.localTimeReview, { date: "2026-11-14", time: "17:00", state: null, reason: "timezone_unknown" });
});

test("ganaderías, lotes mixtos y plazas con nombre", () => {
  assert.deepEqual(parseCattle("1 Zacatepec | 6 Caparica"), { breeding: "Zacatepec, Caparica", cattleCount: 7 });
  assert.deepEqual(parseCattle("6 Cuatro Caminos | José Barba 6"), { breeding: "Cuatro Caminos, José Barba", cattleCount: 6 });
  assert.deepEqual(parseCattle("4 José Garfias 4 (2 novillos)"), { breeding: "José Garfias", cattleCount: 4 });
  assert.deepEqual(parseCattle("5 Diferentes ganaderías 5"), { breeding: "", cattleCount: 5 });
  assert.deepEqual(parsePlace('Plaza "San Marcos" de Aguascalientes, Ags.'),
    { town: "Aguascalientes", state: "Ags", plaza: "San Marcos" });
  assert.deepEqual(find("2026-10-18", "Apizaco").participants, []); // «Triunfadores del ciclo» no es un actuante.
});

// Versiones normalizadas tal como llegan a mergeTwoEvents.
const alToro = (overrides = {}) => ({
  id: "altoromexico-aaaa", date: "2026-10-30", time: null, location: "Monterrey (Nuevo León) México",
  name: "Monterrey (Nuevo León) México", country: "México", type: "Corrida de toros", contentType: "festejo",
  channel: "Sin TV", televised: false, breeding: "Felipe González",
  participants: ["Guillermo Hermoso de Mendoza", "Juan Fernando", "Luis David"],
  sourceLocalDate: "2026-10-30", sourceLocalTime: "20:30", sourceTimeZone: "America/Monterrey",
  sources: ["Al Toro México"], sourceDetails: [{ name: "Al Toro México", fetchedAt: "2026-10-09T08:30:00Z" }],
  fieldSources: { type: "Al Toro México", localTime: "Al Toro México" }, ...overrides
});
const mundotoro = (overrides = {}) => ({
  id: "mundotoro-bbbb", date: "2026-10-30", time: null, location: "Monterrey (Nuevo León) México",
  name: "Monterrey (Nuevo León) México", type: "Corrida de toros", contentType: "festejo", channel: "Sin TV",
  televised: false, breeding: "Felipe González",
  participants: ["Guillermo Hermoso de Mendoza", "Juan Fernando", "Luis David Adame"],
  sources: ["Mundotoro"], sourceDetails: [{ name: "Mundotoro", fetchedAt: "2026-10-08T16:47:35Z" }],
  fieldSources: { type: "Mundotoro" }, ...overrides
});

test("Al Toro + Mundotoro: un solo evento, ID publicado intacto y horario local en ambos órdenes", () => {
  for (const merged of [mergeTwoEvents(mundotoro(), alToro()), mergeTwoEvents(alToro(), mundotoro())]) {
    assert.equal(merged.id, "mundotoro-bbbb");
    assert.deepEqual(localSchedule(merged),
      { sourceLocalDate: "2026-10-30", sourceLocalTime: "20:30", sourceTimeZone: "America/Monterrey" });
    assert.equal(merged.fieldSources.localTime, "Al Toro México");
    assert.equal(merged.time, null);
    // Cartel de Al Toro, completado solo con el nombre largo equivalente.
    assert.deepEqual(merged.participants, ["Guillermo Hermoso de Mendoza", "Juan Fernando", "Luis David Adame"]);
    assert.deepEqual(merged.sources.sort(), ["Al Toro México", "Mundotoro"]);
  }
});

test("Al Toro manda sobre una fuente secundaria en el cartel, sin añadir nombres dudosos", () => {
  const guadalajara = { date: "2026-10-11", location: "Guadalajara (Jalisco) México", name: "Guadalajara (Jalisco) México",
    sourceLocalDate: "2026-10-11", sourceLocalTime: "16:30", sourceTimeZone: "America/Mexico_City" };
  const merged = mergeTwoEvents(
    mundotoro({ ...guadalajara, id: "mundotoro-g", type: "Novillada", participants: ["El Canelo", "Jairo López"],
      sourceLocalDate: undefined, sourceLocalTime: undefined, sourceTimeZone: undefined }),
    alToro({ ...guadalajara, type: "Novillada", participants: ["Emilio Cano", "Jairo López", "Axel López"] }));
  assert.deepEqual(merged.participants, ["Emilio Cano", "Jairo López", "Axel López"]);
  assert.equal(merged.sourceLocalTime, "16:30");
  // «Gilio II» y «Gilio III» no son el mismo nombre.
  const pachuca = mergeTwoEvents(mundotoro({ participants: ["Arturo Gilio III"] }), alToro({ participants: ["Arturo Gilio II"] }));
  assert.deepEqual(pachuca.participants, ["Arturo Gilio II"]);
});

test("Al Toro aporta la hora y la otra fuente completa cartel y ganadería que Al Toro no tiene", () => {
  const merged = mergeTwoEvents(
    mundotoro({ breeding: "Felipe González", participants: ["Guillermo Hermoso de Mendoza", "Juan Fernando", "Luis David Adame"] }),
    alToro({ breeding: "", participants: [] }));
  assert.equal(merged.breeding, "Felipe González");
  assert.deepEqual(merged.participants, ["Guillermo Hermoso de Mendoza", "Juan Fernando", "Luis David Adame"]);
  assert.equal(merged.sourceLocalTime, "20:30");
});

test("una fuente oficial gana sobre Al Toro en horario, cartel y modalidad", () => {
  const official = mundotoro({ id: "oficial-1", sources: ["Empresa oficial Monterrey"],
    sourceDetails: [{ name: "Empresa oficial Monterrey", fetchedAt: "2026-10-09T10:00:00Z" }],
    fieldSources: { type: "Empresa oficial Monterrey", localTime: "Empresa oficial Monterrey" },
    type: "Rejones", participants: ["Guillermo Hermoso de Mendoza", "Juan Fernando", "Luis David Adame", "Sustituto"],
    sourceLocalDate: "2026-10-30", sourceLocalTime: "20:00", sourceTimeZone: "America/Monterrey" });
  for (const merged of [mergeTwoEvents(official, alToro()), mergeTwoEvents(alToro(), official)]) {
    assert.equal(merged.sourceLocalTime, "20:00");
    assert.equal(merged.fieldSources.localTime, "Empresa oficial Monterrey");
    assert.equal(merged.type, "Rejones");
    assert.ok(merged.participants.includes("Sustituto"));
    assert.equal(merged.id, "oficial-1");
  }
});

test("el horario local viaja completo: nunca fecha de una fuente y zona de otra", () => {
  const partial = mundotoro({ sourceLocalDate: "2026-10-30", sourceLocalTime: "19:00" }); // sin zona: no vale
  const merged = mergeTwoEvents(partial, alToro());
  assert.deepEqual(localSchedule(merged),
    { sourceLocalDate: "2026-10-30", sourceLocalTime: "20:30", sourceTimeZone: "America/Monterrey" });
  assert.equal(localSchedule({ sourceLocalDate: "2026-10-30", sourceLocalTime: "20:30", sourceTimeZone: "Mexico/Inventada" }), null);
});
