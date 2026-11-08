// A failed guide read is not a confirmed empty programme.
export function preserveGuideOnFailure(current, previous) {
  if (!current.errorCount) return current;
  const usable = previous && Array.isArray(previous.events) &&
    ['ok', 'stale'].includes(previous.status) &&
    Number.isFinite(Date.parse(previous.lastSuccessfulAt || previous.generatedAt));
  return {
    ...current,
    status: usable ? 'stale' : 'unavailable',
    lastAttemptAt: current.generatedAt,
    generatedAt: usable ? previous.generatedAt : null,
    lastSuccessfulAt: usable ? previous.lastSuccessfulAt || previous.generatedAt : null,
    events: usable ? previous.events : [],
    eventCount: usable ? previous.events.length : 0,
  };
}
