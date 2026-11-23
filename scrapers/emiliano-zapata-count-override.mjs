// Corrección puntual del cartel presentado el 17/11/2026.
// https://elmedianil.com.mx/presentan-oficialmente-el-cartel-de-la-corrida-de-feria-de-emiliano-zapata-tlaxcala/
// No acredita ganadería ni sorteo; frenar ante un cartel nuevo incompatible.
const ids = new Set(["mundotoro-f45f7bf72f3046", "altoromexico-c9c4985573500f"]);
const text = "4 toros anunciados. Ganadería por designar.";
const key = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
export function applyEmilianoZapataCount(events) {
  const matches = events.map((e, i) => ids.has(e.id) ? i : -1).filter((i) => i >= 0);
  if (matches.length !== 1) return false;
  const index = matches[0];
  const event = events[index];
  const participants = (event.participants || []).map(key);
  if (event.date !== "2026-11-23" || event.contentType !== "festejo" ||
      key(event.type) !== "corrida de toros" || key(event.country) !== "mexico" ||
      key(event.location) !== "emiliano zapata (tlaxcala) mexico" ||
      event.sourceLocalDate !== "2026-11-23" || event.sourceLocalTime !== "15:00" ||
      event.sourceTimeZone !== "America/Mexico_City" || key(event.breeding) !== "por designar" ||
      participants.length !== 3 || !participants.includes("carlos fuentes") ||
      !participants.includes("luis gallardo") ||
      !participants.some((p) => p === "luis martinez solis" || p === "luis martinez") ||
      (event.cattleCount != null && event.cattleCount !== 4) ||
      [event.description, event.notes, event.details].some((x) => x != null && x !== "" && x !== text)) return false;
  if (event.cattleCount === 4 && event.description === text) return false;
  events[index] = { ...event, cattleCount: 4, description: text };
  return true;
}
