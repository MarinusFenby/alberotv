import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function loadClient(userTimeZone = 'Europe/Madrid') {
  const context = vm.createContext({Intl, Date});
  const functions = source.slice(source.indexOf('function escapeHtml'), source.indexOf('const CHANNEL_LOGOS'))
    .replace('const USER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";',
      `const USER_TIME_ZONE = ${JSON.stringify(userTimeZone)};`);
  vm.runInContext(functions, context);
  for (const name of ['getEventInstant', 'getEventStartDate', 'getClosestEventIndexForToday', 'isNonTelevisedEvent', 'buildBroadcastMarkup', 'buildEventHeaderMarkup']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\nfunction ', start + 1)), context);
  }
  return context;
}
// Public-source schedule, not a hand-coded exception in the implementation.
// https://desolysombra.com/2026/11/12/agenda-taurina-en-mexico-todos-los-carteles-del-13-al-15-de-noviembre/
const xmatkuil = Object.freeze({
  id: 'mundotoro-6ff2a56e82c625', date: '2026-11-15', time: null,
  sourceLocalDate: '2026-11-15', sourceLocalTime: '16:30', sourceTimeZone: 'America/Merida',
  location: 'Xmatkuil (Yucatán) México', type: 'Corrida de toros',
  breeding: 'Barralva', channel: 'Sin TV', televised: false
});
const unknown = {main: 'Hora por confirmar', original: '', dayShift: '', title: ''};
const c = loadClient();

for (const [zone, main, dayShift] of [
  ['Europe/Madrid', '23:30', ''], ['America/Merida', '16:30', ''],
  ['UTC', '22:30', ''], ['Asia/Tokyo', '07:30', '+1 día'],
  ['Pacific/Honolulu', '12:30', '']
]) {
  test(`Xmatkuil uses one instant and the existing format in ${zone}`, () => {
    const client = loadClient(zone);
    assert.equal(client.hasValidEventTime(xmatkuil), true);
    for (const name of ['getEventStartInstant', 'getEventInstant', 'getEventStartDate'])
      assert.equal(client[name](xmatkuil).toISOString(), '2026-11-15T22:30:00.000Z');
    const presentation = client.getEventTimePresentation(xmatkuil);
    assert.equal(presentation.main, main);
    assert.equal(presentation.original, '23:30');
    assert.equal(presentation.dayShift, dayShift);
    assert.ok(presentation.title.startsWith(`Hora local: ${main}${dayShift ? ` (${dayShift})` : ''}. Hora en España: 23:30. `));
    const markup = client.buildTimeMarkup(xmatkuil);
    assert.ok(markup.includes(`<span class="time-main">${main}</span>`));
    assert.ok(markup.includes('<span class="time-origin">España: 23:30</span>'));
    assert.equal(markup.includes('time-day-shift'), Boolean(dayShift));
    assert.ok(markup.includes('aria-label='));
  });
}
for (const [event, iso] of [
  [{date: '2026-01-15', time: '18:30'}, '2026-01-15T17:30:00.000Z'],
  [{date: '2026-07-15', time: '18:30'}, '2026-07-15T16:30:00.000Z'],
  [{date: '2026-11-15', time: '9:05'}, '2026-11-15T08:05:00.000Z'],
  [{date: '2026-03-29', time: '01:30'}, '2026-03-29T00:30:00.000Z'],
  [{date: '2026-03-29', time: '03:30'}, '2026-03-29T01:30:00.000Z'],
  [{date: '2026-10-25', time: '01:30'}, '2026-10-24T23:30:00.000Z'],
  [{date: '2026-10-25', time: '03:30'}, '2026-10-25T02:30:00.000Z']
]) {
  test(`legacy Madrid retains ${event.date} ${event.time}`, () => {
    assert.equal(c.getEventStartInstant(event).toISOString(), iso);
    assert.equal(c.getEventTimePresentation(event).original, event.time);
  });
}
for (const [date, time, zone, iso] of [
  ['2026-07-15', '16:30', 'America/Merida', '2026-07-15T22:30:00.000Z'],
  ['2026-01-15', '16:30', 'America/Tijuana', '2026-01-16T00:30:00.000Z'],
  ['2026-07-15', '16:30', 'America/Tijuana', '2026-07-15T23:30:00.000Z'],
  ['2026-11-15', '16:30', 'America/Lima', '2026-11-15T21:30:00.000Z'],
  ['2026-11-15', '16:30', 'Asia/Kathmandu', '2026-11-15T10:45:00.000Z'],
  ['2026-07-15', '16:30', 'Australia/Lord_Howe', '2026-07-15T06:00:00.000Z']
]) {
  test(`explicit IANA schedule ${date} ${zone}`, () => {
    const event = {date, time: null, sourceLocalDate: date, sourceLocalTime: time, sourceTimeZone: zone};
    assert.equal(c.getEventStartInstant(event).toISOString(), iso);
  });
}

test('day changes remain relative to the displayed event date, without rewriting it', () => {
  const event = {...xmatkuil, sourceLocalTime: '20:00'};
  const presentation = c.getEventTimePresentation(event);
  assert.equal(presentation.main, '03:00');
  assert.equal(presentation.original, '03:00');
  assert.equal(presentation.dayShift, '+1 día');
  const priorDay = loadClient('America/Los_Angeles').getEventTimePresentation({date: '2026-11-15', time: '00:30'});
  assert.equal(priorDay.main, '15:30');
  assert.equal(priorDay.dayShift, '−1 día');
});

test('equivalent local and legacy evidence is accepted, including across midnight', () => {
  assert.equal(c.getEventStartInstant({...xmatkuil, time: '23:30'}).toISOString(), '2026-11-15T22:30:00.000Z');
  const nextDay = {...xmatkuil, date: '2026-11-16', time: '03:00', sourceLocalTime: '20:00'};
  assert.equal(c.getEventStartInstant(nextDay).toISOString(), '2026-11-16T02:00:00.000Z');
});

const invalid = [
  {}, {date: '2026-11-15', time: null},
  {...xmatkuil, sourceLocalDate: null}, {...xmatkuil, sourceLocalTime: null},
  {...xmatkuil, sourceTimeZone: null}, {...xmatkuil, sourceTimeZone: 'Invalid/Zone'},
  {...xmatkuil, sourceLocalDate: '2026-02-30'}, {...xmatkuil, sourceLocalTime: '24:00'},
  {...xmatkuil, sourceLocalTime: '16:60'}, {...xmatkuil, sourceLocalTime: '16:30:00'},
  {...xmatkuil, time: '16:30'}, {...xmatkuil, time: '23:30', sourceLocalDate: null},
  {date: '2026-02-30', time: '16:30'}, {date: '2026-11-15', time: '24:00'},
  {date: '2026-11-15', time: '16:60'}, {...xmatkuil, time: 'por confirmar'},
  {date: '2026-11-15', time: null, localTimeReview: {date: '2026-11-15', time: '16:30', state: 'Yucatán'}},
  {date: '2026-03-29', time: '02:30'}, {date: '2026-10-25', time: '02:30'},
  {date: '2026-03-29', sourceLocalDate: '2026-03-29', sourceLocalTime: '02:30', sourceTimeZone: 'Europe/Madrid'},
  {date: '2026-10-25', sourceLocalDate: '2026-10-25', sourceLocalTime: '02:30', sourceTimeZone: 'Europe/Madrid'},
  {date: '2026-03-08', sourceLocalDate: '2026-03-08', sourceLocalTime: '02:30', sourceTimeZone: 'America/Tijuana'},
  {date: '2026-11-01', sourceLocalDate: '2026-11-01', sourceLocalTime: '01:30', sourceTimeZone: 'America/Tijuana'}
];
for (const [index, event] of invalid.entries()) {
  test(`uncertain, partial, invalid or contradictory schedule ${index + 1} stays unconfirmed`, () => {
    assert.equal(c.hasValidEventTime(event), false);
    for (const name of ['getEventStartInstant', 'getEventInstant', 'getEventStartDate']) assert.equal(c[name](event), null);
    assert.deepEqual(plain(c.getEventTimePresentation(event)), unknown);
    assert.equal(c.buildTimeMarkup(event), '<div class="time">Hora por confirmar</div>');
  });
}

test('all conversions leave evidence, IDs, date, raw time and television untouched', () => {
  for (const event of [xmatkuil, {...xmatkuil, time: '23:30'}, ...invalid]) {
    const before = structuredClone(event);
    c.getEventTimePresentation(event);
    c.getEventStartInstant(event);
    c.getEventInstant(event);
    assert.deepEqual(event, before);
  }
  const instant = c.getEventStartInstant(xmatkuil);
  instant.setUTCFullYear(2000);
  assert.equal(c.getEventStartInstant(xmatkuil).toISOString(), '2026-11-15T22:30:00.000Z');
});


test('the same local instant drives temporal status before, during and after the existing estimated window', () => {
  assert.equal(c.getTemporalStatus(xmatkuil, new Date('2026-11-15T22:29:00Z')).key, 'starting-soon');
  assert.equal(c.getTemporalStatus(xmatkuil, new Date('2026-11-15T22:30:00Z')).key, 'live');
  assert.equal(c.getTemporalStatus(xmatkuil, new Date('2026-11-16T00:59:59Z')).key, 'live');
  assert.equal(c.getTemporalStatus(xmatkuil, new Date('2026-11-16T01:00:00Z')).key, 'finished');
  assert.equal(c.getTemporalStatus({...xmatkuil, sourceTimeZone: null}), null);
  assert.ok(c.buildTemporalStatusMarkup(xmatkuil).includes('data-event-start="2026-11-15T22:30:00.000Z"'));
});

test('Sin TV with a complete local schedule uses the existing timed header without claiming television', () => {
  const markup = c.buildEventHeaderMarkup(xmatkuil);
  assert.ok(markup.includes('España: 23:30'));
  assert.ok(markup.includes('SIN TV'));
  assert.ok(markup.includes('aria-label="No televisado"'));
  assert.equal(markup.includes('non-tv-without-time'), false);
  assert.equal(markup.includes('channel-logo-circle'), false);
  const incomplete = c.buildEventHeaderMarkup({...xmatkuil, sourceLocalTime: null});
  assert.ok(incomplete.includes('non-tv-without-time'));
  assert.ok(incomplete.includes('SIN TV'));
  assert.equal(incomplete.includes('time-main'), false);
});

test('nearest-event selection includes source-local starts and keeps unknown starts out', () => {
  const events = [{date: '2026-11-15', time: null}, {...xmatkuil, sourceLocalTime: '15:30'}, xmatkuil];
  assert.equal(c.getClosestEventIndexForToday(events, new Date('2026-11-15T22:00:00Z')), 2);
});


test('legacy informational fallback is unchanged without a source-local evidence block', () => {
  for (const text of ['por confirmar', 'Pendiente', 'Tras el festejo']) {
    const event = {date: '2026-11-15', time: text};
    assert.deepEqual(plain(c.getEventTimePresentation(event)), {...unknown, main: text});
    assert.equal(c.getEventStartInstant(event), null);
  }
  assert.deepEqual(plain(c.getEventTimePresentation({...xmatkuil, time: 'por confirmar'})), unknown);
});
