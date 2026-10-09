import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildEvent, extractLocation, isPlausiblePlace } from "../scrapers/canalsur.mjs";
import { eventMatchScore, mergeTwoEvents } from "../scrapers/merge.mjs";

// Nota de prensa real de RTVA (08/10/2026) que bloqueaba actualizar-todo desde
// el 08/10 21:48Z con «Parrilla imposible» en Canal Sur el 31/10 a las 17:00.
const url = "https://www.canalsur.es/rtva/comunicacion/rtva/canal-sur-television-emitira-final_1_1442347.html";
const html = fs.readFileSync(new URL("./fixtures/canalsur-final-liga-novilladas-sanlucar-2026-10-08.html", import.meta.url), "utf8");
const event = buildEvent({ html, finalUrl: url, rssTitle: "" });

test("la final de Sanlúcar: localidad completa, sin el fragmento de frase", () => {
  assert.equal(event.location, "Sanlúcar de Barrameda (Cádiz)");
  assert.equal(event.id, "canalsur-2026-10-31-sanlucar-de-barrameda-cadiz");
  assert.equal(event.date, "2026-10-31");
  assert.equal(event.time, "17:00");
  assert.equal(event.type, "Novillada con picadores");
  assert.equal(event.breeding, "Fuente Ymbro");
  assert.doesNotMatch(event.location, /presentado|Andaluc/);
  // «para los novilleros con picadores”» no es un cartel.
  assert.deepEqual(event.participants, []);
});

test("regla general del titular «se celebrará … en X» y forma completa del cuerpo", () => {
  const title = "Canal Sur Televisión emitirá la Final de la Liga Nacional de Novilladas que se celebrará el sábado 31 de octubre en Sanlúcar";
  assert.equal(extractLocation(title, "sin más datos"), "Sanlúcar");
  assert.equal(extractLocation(title, "que se celebrará en Sanlúcar de Barrameda (Cádiz) el próximo 31"), "Sanlúcar de Barrameda (Cádiz)");
  assert.equal(extractLocation("La corrida que se celebrará el domingo en Écija", ""), "Écija");
});

test("el cuerpo solo aporta localidades con forma de nombre propio", () => {
  const text = "Por tercer año consecutivo, el festejo taurino se celebra en Andalucía y ha sido presentado la tarde de este jueves 8 de octubre en San Telmo";
  assert.equal(extractLocation("Canal Sur emitirá la final", text), "");
  for (const place of ["Sanlúcar de Barrameda (Cádiz)", "La Línea de la Concepción", "El Puerto de Santa María", "Écija"]) {
    assert.equal(isPlausiblePlace(place), true, place);
  }
  for (const fragment of ["Andalucía y ha sido presentado la tarde de", "Sanlúcar y", "la plaza", "Málaga para"]) {
    assert.equal(isPlausiblePlace(fragment), false, fragment);
  }
});

// Salida de main (1f80fae) para los titulares reales revisados el 09/10/2026.
test("los titulares que ya funcionaban dan la misma localidad que en main", () => {
  const unchanged = {
    "Toros: en directo desde Ubrique (Cádiz)": "Ubrique (Cádiz)",
    "Toros desde Villacarrillo en la tarde de Canal Sur TV": "Villacarrillo",
    "Novillada de jóvenes promesas desde La Línea de la Concepción": "La Línea de la Concepción",
    "Canal Sur emite la final del VII Circuito de Novilladas de Andalucía desde La Malagueta": "La Malagueta",
    "Este domingo,  novillada de promoción desde Las Navas de San Juan": "Las Navas de San Juan",
    "Este domingo, toros desde la plaza de Tarifa": "la plaza de Tarifa",
    "Tarde de toros desde Écija, en Canal Sur TV": "",
    "Manzanares, Talavante y Juan Ortega en la primera corrida de la Feria de San Miguel": ""
  };
  for (const [title, location] of Object.entries(unchanged)) assert.equal(extractLocation(title, ""), location, title);
});

test("se fusiona con el festejo real de Sanlúcar: una sola ficha, sin conflicto de parrilla", () => {
  const muletazo = {
    id: "alberotv-muletazo-sanlucar", date: "2026-10-31", time: "17:00", channel: "Canal Sur", televised: true,
    location: "Sanlúcar de Barrameda (Cádiz)", name: "Sanlúcar de Barrameda (Cádiz)", type: "Novillada con picadores",
    contentType: "festejo", breeding: "Fuente Ymbro",
    participants: ["Sergio Rollón", "Marco Polope", "Manuel Quintana", "Jorge Oliva", "Pepe Martínez"],
    sources: ["El Muletazo"], fieldSources: { type: "El Muletazo" }
  };
  const canalSur = { ...event, name: event.location, contentType: "festejo", televised: true, channel: "Canal Sur",
    sources: ["Canal Sur"], fieldSources: { type: "Canal Sur" } };
  assert.ok(eventMatchScore(muletazo, canalSur) > 0);
  const merged = mergeTwoEvents(muletazo, canalSur);
  assert.equal(merged.location, "Sanlúcar de Barrameda (Cádiz)");
  assert.equal(merged.time, "17:00");
  assert.deepEqual(merged.participants, muletazo.participants);
  assert.deepEqual([...merged.sources].sort(), ["Canal Sur", "El Muletazo"]);
});
