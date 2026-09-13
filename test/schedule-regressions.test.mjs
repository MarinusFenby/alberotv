import test from 'node:test';
import assert from 'node:assert/strict';
import {eventMatchScore,mergeTwoEvents,removeVerifiedAlmendralejoDuplicate} from '../scrapers/merge.mjs';
import {cleanLocation} from '../scrapers/canalsur.mjs';
const program={id:'p',date:'2026-09-13',contentType:'programa',type:'Programa taurino',location:'Televisión',name:'Toros para Todos',title:'Toros para Todos',channel:'Canal Sur',sources:['Canal Sur'],time:'13:00',participants:[]};
test('la guía conserva la hora del programa',()=>{
 assert.equal(mergeTwoEvents({...program,time:null},program).time,'13:00');
});
test('programas distintos nunca se unen por Televisión',()=>{
 assert.equal(eventMatchScore(program,{...program,title:'Extremadura Tierra de Toros',channel:'Canal Extremadura'}),0);
 assert.equal(eventMatchScore(program,{...program,title:'Otro programa'}),0);
});
test('redifusiones y cadenas diferentes permanecen separadas',()=>{
 assert.equal(eventMatchScore(program,{...program,time:'03:15'}),0);
 assert.equal(eventMatchScore(program,{...program,channel:'Canal Extremadura'}),0);
 assert.equal(eventMatchScore(program,{...program,time:null}),100);
});
test('Villacarrillo no incluye la coletilla editorial del titular',()=>{
 assert.equal(cleanLocation('Villacarrillo en la tarde de Canal Sur TV'),'Villacarrillo');
 assert.equal(cleanLocation('Villacarrillo (Jaén)'),'Villacarrillo (Jaén)');
 assert.equal(cleanLocation('La Puebla del Río'),'La Puebla del Río');
});
test('Almendralejo: se conserva el festejo completo y solo se retira el duplicado verificado',()=>{
 const real={id:'real',date:'2026-09-12',time:'21:00',location:'Almendralejo (Badajoz)',type:'Novillada con picadores',breeding:'Chamaco',participants:['Jesús Yglesias','David Gutiérrez','Pepe Martínez']};
 const noise={id:'canal-extremadura-0cd744516c9ee3',date:'2026-09-12',title:'TOROS – GRAN FINAL Circuito de novilladas de Extremadura Almendralejo',participants:[]};
 const events=[real,noise];assert.equal(removeVerifiedAlmendralejoDuplicate(events),1);assert.deepEqual(events,[real]);
 assert.equal(removeVerifiedAlmendralejoDuplicate([noise]),0);
 assert.equal(removeVerifiedAlmendralejoDuplicate([{...real,date:'2026-09-13'},noise]),0);
 assert.equal(removeVerifiedAlmendralejoDuplicate([real,{...noise,id:'another'}]),0);
});
