// File readability is not evidence that a remote source was checked recently.
// Stale data remains available to the merger; this only describes its provenance.
export function sourceHealth(source, now = Date.now(), maxAgeMs = 72 * 60 * 60 * 1000) {
  const data = source.data ?? {};
  const fetchedAt = source.fetchedAt || data.generatedAt || null;
  const base = { label: source.label, eventCount: source.eventCount, fetchedAt };
  if (!source.ok || !Array.isArray(data.events)) {
    return { ...base, status: 'error', error: source.error || 'La fuente no contiene una lista de eventos válida.' };
  }
  if ((data.errorCount ?? 0) > 0 || data.error || ['error', 'partial', 'unavailable', 'stale'].includes(data.status)) {
    return { ...base, status: 'degraded', error: 'El lector comunica errores o cobertura incompleta.', reportedStatus: data.status ?? null, errorCount: data.errorCount ?? null };
  }
  const fetched = Date.parse(fetchedAt ?? '');
  if (!Number.isFinite(fetched)) return { ...base, status: 'unverified', error: 'No consta una fecha válida de lectura de la fuente.' };
  if (fetched > now + 5 * 60 * 1000) return { ...base, status: 'unverified', error: 'La fecha de lectura está en el futuro.' };
  if (now - fetched > maxAgeMs) return { ...base, status: 'stale', error: 'Datos conservados sin una lectura reciente verificada; no implica que los eventos hayan cambiado.' };
  return { ...base, status: 'ok', error: null };
}
