import test from "node:test";
import assert from "node:assert/strict";
import { extractEventsFromBlocks } from "../scrapers/lasventas.mjs";

test("Las Ventas no cruza el cartel con noticias ni paginación", () => {
  const blocks = [
    "Domingo 6 de septiembre a las 18:00 h. Toros de Pedraza de Yeltes para Francisco José Espada, Joaquín Galdós y Christian Parejo.",
    "ESTE JUEVES YA ESTÁN EN LAS VENTAS Los toros de Pedraza protagonistas 26/08/26 ACTUALIDAD NOTICIAS « 1 2 3 4 5 6 7 8 ... 162 163 »",
  ];
  const events = extractEventsFromBlocks(blocks, "https://www.las-ventas.com/actualidad");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].participants, ["Francisco José Espada", "Joaquín Galdós", "Christian Parejo"]);
  assert.equal(events[0].participants.some(value => /jueves|actualidad|162/i.test(value)), false);
});

test("el artículo estructurado recupera a Francisco José Espada sin cambiar de fecha", () => {
  const article = "miércoles 26 de agosto del 2026 Francisco José Espada, Joaquín Galdós y Christian Parejo son los tres nombres protagonistas de la cita de este jueves, 27 de agosto, a las 21h., en la Plaza de Toros de Las Ventas, para lidiar toros de Pedraza de Yeltes. VENTA DE ENTRADAS";
  const [event] = extractEventsFromBlocks([article], "https://www.las-ventas.com/actualidad/articulo");
  assert.equal(event.date, "2026-08-27");
  assert.equal(event.time, "21:00");
  assert.deepEqual(event.participants, ["Francisco José Espada", "Joaquín Galdós", "Christian Parejo"]);
  assert.equal(event.breeding, "Pedraza de Yeltes");
});
