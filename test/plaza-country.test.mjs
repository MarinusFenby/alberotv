import test from "node:test";
import assert from "node:assert/strict";
import { locationCountry, mergeTwoEvents } from "../scrapers/merge.mjs";

// Agenda real del 09/10/2026: El Muletazo publica la hora y «Valencia»;
// Mundotoro publica «Valencia (Valencia) España» sin hora.
const muletazo = {
  id: "mundotoro-7cc2bbd8052c7f", date: "2026-10-09", time: "17:30", location: "Valencia", name: "Valencia",
  type: "Corrida de toros", contentType: "festejo", channel: "À Punt", televised: true,
  participants: ["Morante de la Puebla", "Roca Rey", "Tomás Rufo"], breeding: "Álvaro Núñez",
  sources: ["El Muletazo"], fieldSources: { type: "El Muletazo" }
};
const mundotoro = {
  id: "mundotoro-otro", date: "2026-10-09", time: null, location: "Valencia (Valencia) España",
  name: "Valencia (Valencia) España", type: "Corrida de toros", contentType: "festejo", channel: "Sin TV",
  televised: false, participants: ["Morante de la Puebla", "Roca Rey", "Tomás Rufo"],
  breeding: "Álvaro Núñez Benjumea", sources: ["Mundotoro"], fieldSources: { type: "Mundotoro" }
};

test("Valencia: la fusión conserva el país de Mundotoro y la hora de El Muletazo", () => {
  for (const merged of [mergeTwoEvents(muletazo, mundotoro), mergeTwoEvents(mundotoro, muletazo)]) {
    assert.equal(merged.country, "España");
    assert.equal(merged.time, "17:30");
  }
});

test("la provincia española entre paréntesis identifica España", () => {
  assert.equal(locationCountry("Brea de Tajo (Madrid)"), "España");
  assert.equal(locationCountry("Los Barrios (Cádiz)"), "España");
  assert.equal(locationCountry("Fregenal de la Sierra (Badajoz)"), "España");
});

test("país explícito: Las Ventas, México, Perú, Portugal, Francia", () => {
  assert.equal(locationCountry("Las Ventas (Madrid) España"), "España");
  assert.equal(locationCountry("Guadalajara (Jalisco) México"), "México");
  assert.equal(locationCountry("Fábrica María (Otzolotepec) (Estado de México) México"), "México");
  assert.equal(locationCountry("Lima (Perú)"), "Perú");
  assert.equal(locationCountry("Vila Franca de Xira Portugal"), "Portugal");
  assert.equal(locationCountry("Dax (Landes) Francia"), "Francia");
});

test("sin evidencia no se inventa país", () => {
  assert.equal(locationCountry("Valencia"), null); // También hay plaza en Valencia (Venezuela).
  assert.equal(locationCountry("Onda"), null);
  assert.equal(locationCountry("Montoro (Córdoba)"), null); // Córdoba también es provincia americana.
  assert.equal(locationCountry("Las Palmas de Gran Canaria (Las Palmas)"), null); // Canarias: otra zona.
  assert.equal(locationCountry("Valencia España Venezuela"), null);
});

test("fuentes con países contradictorios no eligen ninguno", () => {
  const merged = mergeTwoEvents({ ...muletazo, country: "México" }, mundotoro);
  assert.equal(merged.country, undefined);
});

test("los programas de televisión no reciben país de plaza", () => {
  const programa = { ...muletazo, contentType: "programa", type: "Programa taurino", location: "Televisión", time: "21:00" };
  assert.equal(mergeTwoEvents(programa, { ...programa, sources: ["Otra"] }).country, undefined);
});
