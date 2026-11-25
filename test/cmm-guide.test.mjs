import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyBroadcast, parseGuideHtml} from '../scrapers/cmm.mjs';

const date = new Date('2026-11-27T23:30:00Z'); // Already Saturday in Madrid.
const tab = (i, label) => `<a class="js-date-tab" role="tab" id="date-tab-${i}" aria-controls="schedule-day-${i}" data-date-target="schedule-day-${i}">${label}</a>`;
const slot = (time, title) => `<a class="schedule-item" href="https://www.cmmplay.es/live/469"><div class="time">${time}</div><h3>${title}</h3></a>`;
const panel = (i, children) => `<div class="schedule-day" role="tabpanel" id="schedule-day-${i}" aria-labelledby="date-tab-${i}">${children.join('')}</div>`;
const season = 'TOROS: LO MEJOR DE LA TEMPORADA';
const guides = '<div class="guide-schedule-wrapper">' + tab(0, 'Hoy') + tab(1, 'domingo 29') +
  panel(0, [slot('07:30', 'NUESTRO CAMPO BRAVO (2008)'), slot('11:45', 'TOREROS, HISTORIA Y ARTE'), slot('17:30', season)]) +
  panel(1, [slot('17:00', season), slot('18:30', 'AVANCE INFORMATIVO: ELECCIONES GENERALES'), slot('18:40', season)]) + '</div>';

test('CMM usa las fechas civiles de Madrid y mantiene dos pases iguales separados por un boletín', () => {
  const {dates, events} = parseGuideHtml(guides, date);
  assert.deepEqual(dates, ['2026-11-28', '2026-11-29']);
  assert.deepEqual(events.filter(e => classifyBroadcast(e.title, e.description, e.date) === 'Programa taurino')
    .map(e => [e.date, e.time]), [['2026-11-28','07:30'],['2026-11-28','11:45'],['2026-11-28','17:30'],['2026-11-29','17:00'],['2026-11-29','18:40']]);
  const bulletin = events.find(e => e.time === '18:30');
  assert.equal(classifyBroadcast(bulletin.title, bulletin.description, bulletin.date), null);
  assert.equal(classifyBroadcast('LO MEJOR DEL OESTE', '', dates[0]), null);
});

test('CMM no confunde la portada, una fecha atrasada o una pestaña mal enlazada con una parrilla válida', () => {
  assert.throws(() => parseGuideHtml('<h1>CMMPlay</h1>', date), /guía de emisiones/);
  assert.throws(() => parseGuideHtml(guides, new Date('2026-11-28T23:30:00Z')), /Fecha de pestaña/);
  assert.throws(() => parseGuideHtml(guides.replace('aria-controls="schedule-day-1"', 'aria-controls="schedule-day-9"'), date), /Vínculo/);
});
