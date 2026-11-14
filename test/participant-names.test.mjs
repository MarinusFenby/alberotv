import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanParticipantName } from '../scrapers/participant-names.mjs';
import { cleanParticipants } from '../scrapers/merge.mjs';

test('limpia todas las variantes escolares, no solo Escuela Taurina', () => {
  for (const school of ['Escuela Comarcal Taurina de Ubrique', 'Escuela Municipal de Tauromaquia de Almería', 'Escuela Cultural de Tauromaquia de Ronda', 'Escuela de Tauromaquia de Sevilla', 'Escuela Taurina Tomás Campuzano-Triana', 'ET Camas, Sevilla', 'E. T. de Palencia', 'Academia Taurina', 'CITAR', 'Centro Internacional de Tauromaquia y Alto Rendimiento']) {
    assert.equal(cleanParticipantName(`Juan Pérez (${school})`), 'Juan Pérez', school);
    assert.equal(cleanParticipantName(`Juan Pérez [${school}]`), 'Juan Pérez', school);
    assert.equal(cleanParticipantName(`Juan Pérez — ${school}`), 'Juan Pérez', school);
    assert.equal(cleanParticipantName(school), '', school);
  }
});

test('paréntesis anidados, comas, y/e y apodos no destruyen el nombre', () => {
  assert.equal(cleanParticipantName('Juan Pérez (Escuela Taurina (sede de Sevilla)) (El Niño)'), 'Juan Pérez (El Niño)');
  assert.equal(cleanParticipantName('Manuel Sánchez «Panita»'), 'Manuel Sánchez «Panita»');
  for (const alias of ['Juan Pérez (El Niño de la Escuela)', 'Juan (El Escuela)', 'Juan «El Escuela»', 'Juan «El de la Escuela»']) {
    assert.equal(cleanParticipantName(alias), alias);
  }
  assert.deepEqual(cleanParticipants(['José Gómez y Ortega', 'Juan Pérez (El Chico, II)', 'Escuela Comarcal Taurina de Ubrique']), ['José Gómez y Ortega', 'Juan Pérez (El Chico, II)']);
});

test('el merge limpia antes del límite de longitud y no conserva instituciones sueltas', () => {
  assert.deepEqual(cleanParticipants(['Juan Pérez (Escuela Municipal de Tauromaquia de una localidad con una denominación muy larga para la prueba)', 'de la Escuela Cultural Taurina de Ronda', 'Juan Pérez', 'Pedro López (CITAR)']), ['Juan Pérez', 'Pedro López']);
});

test('el merge rescata nombres explícitos de un fragmento escolar mal separado', () => {
  assert.deepEqual(cleanParticipants(['(Escuela Taurina de Linares); Pablo Sánchez (Escuela Municipal de Tauromaquia de Almería); Armando Rojo (Escuela de Tauromaquia de Sevilla); Mario Torres (Escuela Comarcal de Tauromaquia de Ubrique); Rojas Ramírez (Escuela Cultural de Tauromaquia de Ronda)']), ['Pablo Sánchez', 'Armando Rojo', 'Mario Torres', 'Rojas Ramírez']);
});
