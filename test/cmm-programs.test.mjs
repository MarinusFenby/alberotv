import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyBroadcast} from '../scrapers/cmm.mjs';
import {eventMatchScore} from '../scrapers/merge.mjs';

// Parrilla real de CMM, octubre de 2026 (data/cmm.json).
test('«TOROS: LO MEJOR DE LA TEMPORADA» es un programa, también con reposiciones fechadas',()=>{
 assert.equal(classifyBroadcast('TOROS: LO MEJOR DE LA TEMPORADA','Toros desde Ciudad Real. Corrida del 20 de agosto de 2026.','2026-10-11'),'Programa taurino');
 assert.equal(classifyBroadcast('TOROS: LO MEJOR DE LA TEMPORADA','Rejones desde Cuenca. La corrida del 23 de agosto de 2026.','2026-10-10'),'Programa taurino');
});
test('una corrida grabada emitida días después es una reposición',()=>{
 assert.equal(classifyBroadcast('TOROS','Corrida del 20 de agosto de 2026 desde Ciudad Real.','2026-10-11'),'Programa taurino');
});
test('las retransmisiones reales siguen siendo festejos',()=>{
 assert.equal(classifyBroadcast('TOROS 2026','Corrida del día de la Hispanidad desde Las Ventas','2026-10-12'),'Festejo taurino');
 assert.equal(classifyBroadcast('TOROS','Corrida de toros desde Albacete','2026-09-10'),'Festejo taurino');
 assert.equal(classifyBroadcast('CORRIDA DE TOROS DESDE ALBACETE','','2026-09-10'),'Corrida de toros');
 assert.equal(classifyBroadcast('REJONES DESDE ALMAGRO','','2026-08-20'),'Corrida de rejones');
 // La fecha del propio día no convierte la retransmisión en reposición.
 assert.equal(classifyBroadcast('CORRIDA DE TOROS','Corrida del 11 de octubre de 2026 desde Toledo.','2026-10-11'),'Corrida de toros');
});
test('Tiempo de Toros sigue siendo programa y lo ajeno a los toros se ignora',()=>{
 assert.equal(classifyBroadcast('TIEMPO DE TOROS','La información taurina, todos los sábados','2026-10-10'),'Programa taurino');
 assert.equal(classifyBroadcast('NOTICIAS CMM','Informativo','2026-10-10'),null);
});
test('un programa de CMM no se une a un festejo de Canal Extremadura en «Televisión»',()=>{
 const program={id:'cmm-2026-10-10-1715-4',date:'2026-10-10',time:'17:15',contentType:'programa',type:'Programa taurino',location:'Televisión',name:'TOROS: LO MEJOR DE LA TEMPORADA',title:'TOROS: LO MEJOR DE LA TEMPORADA',channel:'CMM',sources:['CMM'],participants:[]};
 const festejo={id:'canal-extremadura-e49d671e5e1409',date:'2026-10-10',time:'15:15',contentType:'festejo',type:'Festejo taurino',location:'Televisión',name:'TOROS – ',title:'TOROS – ',channel:'Canal Extremadura',sources:['Canal Extremadura'],participants:[]};
 assert.equal(eventMatchScore(program,festejo),0);
});
