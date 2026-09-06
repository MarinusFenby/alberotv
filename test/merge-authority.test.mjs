import test from "node:test";
import assert from "node:assert/strict";
import { mergeTwoEvents } from "../scrapers/merge.mjs";

const taurine = { id: "bull", date: "2026-09-06", location: "Ondara", type: "Novillada",
  time: "18:30", participants: ["Simón Andreu", "Marco Polope"], breeding: "Castillejo de Huebra",
  sources: ["MundoToro"], fieldSources: { participants: "MundoToro", breeding: "MundoToro", time: "MundoToro" } };
const tv = { id: "tv", date: "2026-09-06", location: "Televisión", type: "Festejo taurino",
  time: "20:00", participants: ["Noticias de actualidad muy largas"], breeding: "Especial Toros 2026",
  channel: "CMM", televised: true, sources: ["CMM guía TV"],
  fieldSources: { participants: "CMM guía TV", breeding: "CMM guía TV", time: "CMM guía TV", television: "CMM guía TV" } };

test("la guía TV solo gana televisión, nunca cartel ganadería u hora taurina", () => {
  const merged = mergeTwoEvents(taurine, tv);
  assert.deepEqual(merged.participants, taurine.participants);
  assert.equal(merged.breeding, taurine.breeding);
  assert.equal(merged.time, taurine.time);
  assert.equal(merged.channel, "CMM");
});

test("una hora exclusivamente televisiva no se publica como hora del festejo", () => {
  assert.equal(mergeTwoEvents({ ...taurine, time: null }, tv).time, null);
});
