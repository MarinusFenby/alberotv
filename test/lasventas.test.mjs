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
