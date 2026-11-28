import assert from "node:assert/strict";
import test from "node:test";
import { eventMatchScore, mergeVerifiedMugronCartels } from "../scrapers/merge.mjs";

test("Mugron: publica dos carteles completos sin compartir horas, toreros ni ganaderías", () => {
  const unrelated = { id: "control", date: "2027-03-28", contentType: "festejo" };
  const rows = [unrelated];
  assert.deepEqual(mergeVerifiedMugronCartels(rows).map(r => r.merged), [false, false]);
  const [first, morning, afternoon] = rows;
  assert.equal(first, unrelated);
  assert.equal(eventMatchScore(morning, afternoon), 0);
  for (const row of [morning, afternoon]) {
    assert.equal(row.date, "2027-03-29");
    assert.equal(row.sourceLocalDate, row.date);
    assert.equal(row.sourceLocalTime, row.time);
    assert.equal(row.sourceTimeZone, "Europe/Paris");
    assert.equal(row.status, "confirmed");
    assert.equal(row.televised, false);
    assert.equal(row.televisionUnconfirmed, true);
    assert.match(row.sourceUrl, /^https:\/\/www\.aplausos\.es\//);
  }
  assert.deepEqual([morning.time, morning.type, morning.breeding, morning.participants],
    ["11:00", "Novillada sin picadores", "Alma Serena", ["Julio Martín", "Maxence Alcaïde"]]);
  assert.deepEqual([afternoon.time, afternoon.type, afternoon.breeding, afternoon.participants],
    ["16:30", "Novillada con picadores", "Hijos de Don Ignacio Pérez Tabernero",
      ["Manuel Quintana", "Jorge Oliva", "Fernando Vanegas"]]);
  assert.deepEqual(mergeVerifiedMugronCartels(rows).map(r => r.merged), [true, true]);
  assert.deepEqual(rows.map(r => r.id), ["control", morning.id, afternoon.id]);
});
