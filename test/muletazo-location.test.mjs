import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLocation,extractBreeding} from '../scrapers/elmuletazo.mjs';
import {cleanAgendaLocation} from '../scrapers/merge.mjs';

// Fichas reales de El Muletazo (agenda de toros en televisión, 08/10/2026).
const brea='Sábado 10 de Octubre de 2026 ⏰️17:15h🇪🇸. 📺 Onetoro . 🏟 Toros desde Brea de Tajo (Madrid)🐂Novillada sin picadores – Gran Final del V Certamen de Novilladas sin Picadores del Sureste 📜 Novillos de «El Montecillo» para Israel Guirao, José Huelves y Rubén Vara.🔗 (Pulsa aquí para acceder a la emisión en Pago por Visión de Onetoro) 🗓';
const jaen='Domingo 11 de Octubre de 2026 ⏰️17:30h🇪🇸. 📺 Canal Sur Televisión . 🏟 Toros desde Jaén. 🐂Corrida de Toros Mixta – Feria de San Lucas📜 Toros de Victorino Martín para el rejoneador Diego Ventura y los matadores «El Cid» y Manuel Escribano. 🔗 (Pulsa aquí para acceder a la emisión en directo de Canal Sur) 🗓';
const ventas='Domingo 11 de Octubre de 2026 ⏰️17:30h🇪🇸. 📺 Telemadrid . 🏟 Toros desde Madrid – Plaza de Toros de Las Ventas. 🐂Corrida de Toros – Feria de Otoño 📜 Toros de Victoriano del Río para A, B y C. 🔗';

test('Brea de Tajo: la plaza termina antes del emoji; el resto no entra en el título',()=>{
 assert.equal(extractLocation(brea),'Brea de Tajo (Madrid)');
 assert.equal(extractBreeding(brea),'El Montecillo');
});
test('Jaén y Las Ventas no cambian',()=>{
 assert.equal(extractLocation(jaen),'Jaén');
 assert.equal(extractLocation(ventas),'Madrid – Plaza de Toros de Las Ventas');
});
test('una descripción larga detrás de la plaza nunca contamina la localidad visible',()=>{
 assert.equal(cleanAgendaLocation('Brea de Tajo (Madrid)🐂Novillada sin picadores – Gran Final del V Certamen 📜 Novillos de «El Montecillo» para Israel Guirao, José Huelves y Rubén Vara'),'Brea de Tajo (Madrid)');
 assert.equal(cleanAgendaLocation('Valencia 📜 Toros de Garcigrande para A, B y C'),'Valencia');
 assert.equal(cleanAgendaLocation('Madrid – Plaza de Toros de Las Ventas'),'Madrid – Plaza de Toros de Las Ventas');
 assert.equal(cleanAgendaLocation('Villarrubia de los Ojos (Nueva) (Ciudad Real) España'),'Villarrubia de los Ojos (Nueva) (Ciudad Real) España');
});
test('los programas de televisión no cambian',()=>{
 for (const title of ['TOROS: LO MEJOR DE LA TEMPORADA','Toros para Todos','TIEMPO DE TOROS','Televisión'])
  assert.equal(cleanAgendaLocation(title),title);
});
