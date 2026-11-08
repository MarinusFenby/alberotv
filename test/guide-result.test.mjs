import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveGuideOnFailure} from '../scrapers/guide-result.mjs';
const failed={generatedAt:'2026-11-09T10:00:00Z',status:'partial',errorCount:1,errors:[{error:'guide missing'}],events:[],eventCount:0};
const previous={generatedAt:'2026-11-08T10:00:00Z',status:'ok',events:[{id:'verified'}]};
test('un fallo conserva eventos y fecha de la última lectura válida',()=>{
 const out=preserveGuideOnFailure(failed,previous);
 assert.equal(out.status,'stale');assert.deepEqual(out.events,previous.events);
 assert.equal(out.generatedAt,previous.generatedAt);assert.equal(out.lastSuccessfulAt,previous.generatedAt);
 assert.equal(out.lastAttemptAt,failed.generatedAt);assert.equal(out.errorCount,1);
});
test('fallos repetidos no rejuvenecen la lectura ni pierden la copia válida',()=>{
 const one=preserveGuideOnFailure(failed,previous);
 const two=preserveGuideOnFailure({...failed,generatedAt:'2026-11-10T10:00:00Z'},one);
 assert.equal(two.lastSuccessfulAt,previous.generatedAt);assert.deepEqual(two.events,previous.events);
});
test('una lectura válida sin toros sí puede sustituir la anterior',()=>{
 const empty={...failed,errorCount:0,status:'ok',errors:[]};assert.strictEqual(preserveGuideOnFailure(empty,previous),empty);
});
test('sin copia comprobada declara indisponibilidad, nunca una lectura fresca',()=>{
 for(const prior of [null,{...previous,status:'partial'},{...previous,generatedAt:'invalid'}, {...previous,events:null}]) {
  const out=preserveGuideOnFailure(failed,prior);assert.equal(out.status,'unavailable');assert.equal(out.generatedAt,null);assert.equal(out.lastSuccessfulAt,null);
 }
});
