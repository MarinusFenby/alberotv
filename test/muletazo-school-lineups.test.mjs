import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractParticipants } from '../scrapers/elmuletazo.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/elmuletazo-school-lineups.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  test(`extrae todo el cartel y solo nombres: ${fixture.case}`, () => {
    assert.deepEqual(extractParticipants(fixture.sourceText), fixture.expected);
  });
}

test('las escuelas entre paréntesis o corchetes no son nombres, tampoco sus comas ni conjunciones', () => {
  assert.deepEqual(extractParticipants('Novillos de X para Juan Pérez (Escuela Municipal y Comarcal, Sevilla); Iván Torres [Escuela Cultural de Tauromaquia de Ronda] e Ignacio López (ET Camas, Sevilla).'), ['Juan Pérez', 'Iván Torres', 'Ignacio López']);
});

test('conserva apodos personales, incluso comas y conjunciones dentro de ellos', () => {
  assert.deepEqual(extractParticipants('Toros de X para Juan Pérez (El Niño y su Arte), «El Fandi», Manuel Sánchez «Panita» e Iván López (El Chico, II).'), ['Juan Pérez (El Niño y su Arte)', 'El Fandi', 'Manuel Sánchez «Panita»', 'Iván López (El Chico, II)']);
});

test('rechaza afiliaciones aisladas y limpia sufijos sin inventar nombres', () => {
  assert.deepEqual(extractParticipants('Novillos de X para Escuela Comarcal Taurina de Ubrique; Juan Pérez — Escuela Municipal de Tauromaquia de Almería; Pedro López, de la Escuela Cultural y Taurina de Ronda, e Iván Torres (Academia Taurina de Prueba).'), ['Juan Pérez', 'Pedro López', 'Iván Torres']);
});

test('los festejos mixtos usan la misma separación sin escuelas en los nombres', () => {
  assert.deepEqual(extractParticipants('Toros para rejones de Los Espartales y para la lidia a pie de Jandilla para el rejoneador Diego Ventura y los espadas: Juan Pérez (Escuela Comarcal Taurina de Ubrique); Iván Torres e Ignacio López.'), ['Diego Ventura', 'Juan Pérez', 'Iván Torres', 'Ignacio López']);
});

test('un cartel sin nombres sigue vacío', () => {
  assert.deepEqual(extractParticipants('Novillos de X. Cartel por confirmar.'), []);
  assert.deepEqual(extractParticipants('Novillos de X para (Escuela Comarcal Taurina de Ubrique); de la Escuela Municipal de Almería.'), []);
});

// Synthetic coverage: cardinality comes from the supplied names, never from
// the six-person Ubrique fixture or an assumed number of bulls.
test('un cartel de cinco nombres se conserva exactamente, sin rellenar un sexto', () => {
  const expected = ['Juan Pérez', 'Pablo Ruiz', 'Mario Rojas', 'Iván Torres', 'Antonio López'];
  const source = 'Novillos de Prueba para Juan Pérez (Escuela Municipal de Prueba); Pablo Ruiz (Escuela Comarcal Taurina de Prueba); Mario Rojas (Escuela Taurina de Prueba); Iván Torres (ET Prueba); y Antonio López (Academia Taurina de Prueba).';
  assert.deepEqual(extractParticipants(source), expected);
});
