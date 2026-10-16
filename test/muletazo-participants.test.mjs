import test from 'node:test';
import assert from 'node:assert/strict';
import {extractParticipants} from '../scrapers/elmuletazo.mjs';

// Jaén 11/10/2026: el oficio quedaba pegado al nombre y el festejo nunca casó
// con el sorteo publicado.
test('el oficio delante del nombre no forma parte del torero',()=>{
 assert.deepEqual(extractParticipants('🐂Corrida de Toros – Feria de San Lucas📜 Toros de Victorino Martín para el rejoneador Diego Ventura, los matadores «El Cid» y Manuel Escribano. 🔗 (Pulsa aquí)'),
  ['Diego Ventura','El Cid','Manuel Escribano']);
 assert.deepEqual(extractParticipants('📜 Novillos de X para los novilleros Daniel Mosset, Bruno Gimeno y el novillero Manuel Quintana.'),
  ['Daniel Mosset','Bruno Gimeno','Manuel Quintana']);
 assert.deepEqual(extractParticipants('📜 Toros de X para la rejoneadora Lea Vicens y el matador de toros Juan Ortega.'),['Lea Vicens','Juan Ortega']);
});
test('un apodo entrecomillado completo pierde las comillas; dentro de un nombre se conservan',()=>{
 assert.deepEqual(extractParticipants('📜 Toros de «El Parralejo» para «El Fandi», Emilio de Justo y David de Miranda. 🔗 (Pulsa aquí)'),['El Fandi','Emilio de Justo','David de Miranda']);
 assert.deepEqual(extractParticipants('📜 Toros de X para Manuel Sánchez «Panita» y Octavio García «El Payo».'),['Manuel Sánchez «Panita»','Octavio García «El Payo»']);
});
test('nombres que empiezan como un artículo no se recortan',()=>{
 assert.deepEqual(extractParticipants('📜 Toros de X para El Juli, Los Maños de Prueba y Diego Urdiales.'),['El Juli','Los Maños de Prueba','Diego Urdiales']);
});
