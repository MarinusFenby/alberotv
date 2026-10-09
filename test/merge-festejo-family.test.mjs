import test from "node:test";
import assert from "node:assert/strict";
import { eventMatchScore, festejoFamily } from "../scrapers/merge.mjs";

// Agenda real del 12/10/2026: El Muletazo anuncia el concurso de recortadores
// de la mañana en TV; Mundotoro, la corrida de la tarde en la misma plaza.
const recortes = {
  date: "2026-10-12", time: "11:30", channel: "Toros en España Play", televised: true, location: "Zaragoza", name: "Zaragoza",
  type: "Recortes", contentType: "festejo", breeding: "Veiga Texeira y Fermín Bohórquez", participants: [], sources: ["El Muletazo"]
};
const corrida = {
  date: "2026-10-12", time: null, channel: "Sin TV", televised: false, location: "Zaragoza (Zaragoza) España", name: "Zaragoza (Zaragoza) España",
  type: "Corrida de toros", contentType: "festejo", breeding: "Juan Pedro Domecq",
  participants: ["Daniel Luque", "David de Miranda", "Miguel Ángel Perera"], sources: ["Mundotoro"]
};

test("un concurso de recortadores nunca se funde con la corrida del mismo día y plaza", () => {
  assert.equal(eventMatchScore(recortes, corrida), 0);
  assert.equal(eventMatchScore(corrida, recortes), 0);
});

test("familias: populares frente a festejos en plaza", () => {
  assert.equal(festejoFamily("Recortes"), "recortes");
  assert.equal(festejoFamily("Concurso de recortadores"), "recortes");
  assert.equal(festejoFamily("Encierro"), "encierro");
  assert.equal(festejoFamily("Suelta de reses"), "suelta");
  for (const type of ["Corrida de toros", "Rejones", "Novillada sin picadores", "Festival", "Festejo mixto"]) assert.equal(festejoFamily(type), "plaza", type);
  assert.equal(festejoFamily("Festejo taurino"), null);
});

test("dentro de la plaza, un tipo discrepante sigue fusionando (rejones mal tipados como corrida)", () => {
  const rejones = { ...corrida, date: "2026-10-18", type: "Rejones", participants: ["Rui Fernandes", "Diego Ventura", "Duarte Fernandes"] };
  const typedAsCorrida = { ...rejones, type: "Corrida de toros", sources: ["Mundotoro"] };
  assert.ok(eventMatchScore(rejones, typedAsCorrida) >= 90);
});

test("dos sesiones en directo con más de hora y media de diferencia no son el mismo festejo", () => {
  const tarde = { ...corrida, time: "17:30", channel: "Canal X", televised: true };
  const manana = { ...tarde, time: "12:00", participants: ["Daniel Luque", "David de Miranda", "Miguel Ángel Perera"] };
  assert.equal(eventMatchScore(tarde, manana), 0);
  assert.ok(eventMatchScore(tarde, { ...tarde, time: "18:00" }) > 0);
  // Un diferido sí puede emitirse horas después del festejo.
  assert.ok(eventMatchScore(tarde, { ...manana, deferred: true }) > 0);
});

test("dos carteles completos sin ningún nombre en común no se funden", () => {
  const otra = { ...corrida, participants: ["Uno Distinto", "Dos Distinto", "Tres Distinto"] };
  assert.equal(eventMatchScore(corrida, otra), 0);
  // Con un nombre en común (sustitución) sí pueden ser el mismo festejo.
  assert.ok(eventMatchScore(corrida, { ...otra, participants: ["Daniel Luque", "Dos Distinto", "Tres Distinto"] }) > 0);
});

test("el encierro sigue sin fundirse con la corrida", () => {
  assert.equal(eventMatchScore({ ...recortes, type: "Encierro" }, corrida), 0);
});
