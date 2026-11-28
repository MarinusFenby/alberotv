import assert from "node:assert/strict";
import test from "node:test";
import { applyVerifiedTexcocoReplacement } from "../scrapers/merge.mjs";

const exact = {
  id: "mundotoro-17a0e0d66541b2", date: "2026-11-29", sourceLocalDate: "2026-11-29",
  sourceLocalTime: "16:00", sourceTimeZone: "America/Mexico_City",
  location: "Texcoco (Estado de México) México", type: "Corrida de toros", contentType: "festejo",
  status: "confirmed", breeding: "Fernando de la Mora",
  participants: ["José Mauricio", "Isaac Fonseca", "Víctor Hernández"], sources: ["Al Toro México"]
};
test("Texcoco: corrige solo el encierro confirmado y atribuye el cambio a la empresa", () => {
  for (const id of [exact.id, "altoromexico-6e32f60a537c91"]) {
    const other = { ...exact, id: "other", date: "2026-11-22" };
    const events = [{ ...exact, id }, other];
    assert.equal(applyVerifiedTexcocoReplacement(events), true);
    assert.equal(events[0].id, id);
    assert.equal(events[0].breeding, "Torreón de Cañas");
    assert.equal(events[0].cattleCount, 6);
    assert.equal(events[0].sourceDetails[0].sourceUrl, "https://www.santajuliaespectaculos.com/cartel29noviembre2026");
    assert.equal(events[1], other);
    assert.equal(applyVerifiedTexcocoReplacement(events), false);
  }
});
test("Texcoco: no sobrescribe una cancelación, otro hierro o un cartel ambiguo", () => {
  for (const changed of [{ sourceLocalTime: "16:30" }, { status: "cancelled" },
    { breeding: "Otro hierro" }, { id: "desconocido" }, { cattleCount: 4 },
    { participants: ["José Mauricio", "Isaac Fonseca", "Otro"] }]) {
    const row = { ...exact, ...changed };
    const events = [row];
    assert.equal(applyVerifiedTexcocoReplacement(events), false);
    assert.equal(events[0], row);
  }
  assert.equal(applyVerifiedTexcocoReplacement([exact, { ...exact, id: "desconocido" }]), false);
});
