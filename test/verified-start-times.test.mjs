import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyVerifiedStartTimes, VERIFIED_START_TIMES} from '../scrapers/merge.mjs';
const event=i=>({...structuredClone(VERIFIED_START_TIMES[i]),time:null,channel:'Sin TV',televised:false});
test('completa ambas horas y conserva televisión',()=>{let es=[event(0),event(1)];assert.equal(applyVerifiedStartTimes(es),2);assert.deepEqual(es.map(e=>e.time),['18:30','18:00']);for(const e of es){assert.equal(e.channel,'Sin TV');assert.equal(e.televised,false);assert.ok(e.timeEvidence.sourceUrl);}});
test('no sobrescribe una hora distinta',()=>{let e=event(0);e.time='19:00';assert.equal(applyVerifiedStartTimes([e]),0);assert.equal(e.time,'19:00');});
test('idempotente y no renueva auditoría',()=>{let es=[event(0)];applyVerifiedStartTimes(es);const before=JSON.stringify(es);assert.equal(applyVerifiedStartTimes(es),0);assert.equal(JSON.stringify(es),before);});
for(const key of ['id','date','location','type','participants'])test('bloquea contradicción '+key,()=>{let e=event(0);e[key]=key==='participants'?['Otro']: 'otro';assert.equal(applyVerifiedStartTimes([e]),0);assert.equal(e.time,null);});
test('no elige entre duplicados',()=>{assert.equal(applyVerifiedStartTimes([event(0),event(0)]),0);});
test('sigue completando cuando la fuente vuelve sin hora',()=>{for(let i=0;i<2;i++){let es=[event(0),event(1)];assert.equal(applyVerifiedStartTimes(es),2);}});
test('Logroño 21, 22 y 23 conserva las 18:00 en cada regeneración y en sus IDs originales',()=>{
 const verified=VERIFIED_START_TIMES.filter(e=>e.location.startsWith('Logroño'));
 assert.equal(verified.length,3);
 for(const evidence of verified){const e={...structuredClone(evidence),time:null};assert.equal(applyVerifiedStartTimes([e]),1);assert.equal(e.time,'18:00');assert.equal(e.id,evidence.id);assert.equal(e.timeEvidence.sourceUrl,'https://www.bmftoros.com/noticias/presentada-la-feria-de-san-mateo-2026/');}
});
