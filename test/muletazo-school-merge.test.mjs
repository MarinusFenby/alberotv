import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractParticipants } from '../scrapers/elmuletazo.mjs';
import { cleanParticipants, eventMatchScore, mergeTwoEvents } from '../scrapers/merge.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/elmuletazo-school-lineups.json', import.meta.url), 'utf8')).slice(0, 2);
const ids = ['alberotv-2026-11-14-3a16b4192377d47f', 'alberotv-2026-12-05-07d1955bed3cee04'];
const events = fixtures.map(f => ({ ...f.schedule, source: 'El Muletazo', type: 'Novillada sin picadores', sourceText: f.sourceText, sourceUrl: f.sourceUrl, participants: extractParticipants(f.sourceText) }));

test('parser y merge CLI conservan seis nombres, un evento y el mismo ID, fecha, hora, plaza y canal', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alberotv-school-merge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'data'));
  fs.writeFileSync(path.join(directory, 'data/elmuletazo.json'), JSON.stringify({ source: 'El Muletazo', fetchedAt: new Date().toISOString(), events }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scrapers/merge.mjs', import.meta.url))], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(fs.readFileSync(path.join(directory, 'data/programacion.json'), 'utf8'));
  assert.equal(new Set(output.events.map(event => event.id)).size, output.events.length);
  assert.equal(output.events.filter(event => fixtures.some(f => event.date === f.schedule.date && event.location === f.schedule.location)).length, 2);
  for (const [index, fixture] of fixtures.entries()) {
    const matching = output.events.filter(event => event.date === fixture.schedule.date && event.location === fixture.schedule.location);
    assert.equal(matching.length, 1);
    const [event] = matching;
    assert.equal(event.id, ids[index]);
    assert.deepEqual(event.participants, fixture.expected);
    for (const [key, value] of Object.entries(fixture.schedule)) assert.equal(event[key], value, key);
  }
});

test('la recuperación de cuatro nombres casa con la ficha existente, sin alterar su hora', () => {
  const base = { ...events[0], id: ids[0], contentType: 'festejo', sources: ['El Muletazo'] };
  const old = { ...base, participants: cleanParticipants(['Blas Márquez', 'Juan Manuel Viruez (Escuela Comarcal Taurina de Ubrique)']) };
  assert.ok(eventMatchScore(old, base) >= 70);
  const merged = mergeTwoEvents(old, base);
  assert.equal(merged.id, ids[0]);
  assert.deepEqual(new Set(merged.participants), new Set(fixtures[0].expected));
  assert.equal(merged.participants.length, 6);
  for (const [key, value] of Object.entries(fixtures[0].schedule)) assert.equal(merged[key], value, key);
});
