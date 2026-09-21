import test from 'node:test';
import assert from 'node:assert/strict';
import {extractBreeding} from '../scrapers/elmuletazo.mjs';
const venue='🏟 Toros desde Sevilla – Plaza de Toros de la Real Maestranza – . 🐂Corrida de Toros – Feria de San Miguel – 📜 ';
test('Sevilla: plaza y feria nunca son ganaderías',()=>{
 for(const breed of ['Jandilla y Vegahermosa','Garcigrande','Puerto de San Lorenzo y La Ventana del Puerto'])
  assert.equal(extractBreeding(venue+'Toros de '+breed+' para Emilio de Justo, Roca Rey y Pablo Aguado. 🔗 enlace'),breed);
 assert.equal(extractBreeding(venue+'Cartel por confirmar'),'');
 assert.equal(extractBreeding('Desde Plaza de Toros de Las Ventas para un festival'),'');
});
test('sin emojis, espacios variables, mayúsculas y prefijos de plaza',()=>{
 assert.equal(extractBreeding('Plaza de TOROS DE Madrid. Toros de Adolfo Martín para Antonio Ferrera y Román.'),'Adolfo Martín');
 assert.equal(extractBreeding('PLAZA DE TOROS DE SEVILLA'),'');
 assert.equal(extractBreeding('Toros   de   Jandilla para: A y B.'),'Jandilla');
 assert.equal(extractBreeding('🐂Corrida de Toros de la Insurgencia 📜 Toros de Santa Inés y La Asunción para A y B.'),'Santa Inés y La Asunción');
});
test('preserva nombres compuestos y hierros distintos',()=>{
 for(const breed of ['Toros de Cortés','Victoriano del Río y Toros de Cortés','Guerrero y Carpintero y Juan Barriopedro'])
  assert.equal(extractBreeding('📜 Toros de '+breed+' para A y B.'),breed);
});
test('novillos, reses y datos ausentes',()=>{
 assert.equal(extractBreeding('📜 Novillos de Peñajara de Casta Jijona para A, B y C.'),'Peñajara de Casta Jijona');
 assert.equal(extractBreeding('Reses de Alicia Chico. 🔗 enlace'),'Alicia Chico');
 assert.equal(extractBreeding('Toros de la Real Maestranza – Corrida de Toros – Feria de San Miguel'),'');
 assert.equal(extractBreeding('Toros de Jandilla para A. Reses de Garcigrande para B.'),'');
});
test('conserva festejos mixtos',()=>{
 assert.equal(extractBreeding('Toros para rejones de Los Espartales y para la lidia a pie de Jandilla para el rejoneador A y los espadas: B y C.'),'Los Espartales, Jandilla');
});
