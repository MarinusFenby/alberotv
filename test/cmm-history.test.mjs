import test from 'node:test';
import assert from 'node:assert/strict';
import {isRetiredCmmProgramme,seedHistoricalEvents} from '../scrapers/merge.mjs';

// Formas reales de data/historico.json (08/10/2026).
const cmmProgramme=(id,date,title)=>({id,date,time:'18:15',channel:'CMM',location:'Televisión',type:'Programa taurino',contentType:'programa',breeding:'',participants:[],name:title,title,sources:['CMM'],sourceDetails:[{name:'CMM',confidence:98}]});
const western=cmmProgramme('cmm-2026-10-01-1815-1','2026-10-01','LO MEJOR DEL OESTE : HOGUERA DE ODIOS');
const ancha=cmmProgramme('cmm-2026-10-02-1815-2','2026-10-02','LO MEJOR DE ANCHA ES CASTILLA LA MANCHA');
const temporada=cmmProgramme('cmm-2026-10-01-1715-4','2026-10-01','TOROS: LO MEJOR DE LA TEMPORADA');
const tiempo=cmmProgramme('cmm-2026-10-03-1245-4','2026-10-03','TIEMPO DE TOROS');
const toros2026={...cmmProgramme('cmm-2026-07-25-1930-2','2026-07-25','TOROS 2026'),type:'Rejones',contentType:'festejo'};
const festejoCmm={id:'cmm-2026-09-19-1730-5',date:'2026-09-19',time:'17:30',channel:'CMM',location:'Consuegra (Toledo)',type:'Corrida de toros',contentType:'festejo',breeding:'',participants:[],name:'Consuegra (Toledo)',title:null,sources:['CMM']};
const otherSource={id:'toros-para-todos-2026-09-13-1300',date:'2026-09-13',time:'13:00',channel:'Canal Sur',location:'Televisión',type:'Programa taurino',contentType:'programa',name:'Toros para Todos',title:'Toros para Todos',sources:['Canal Sur']};
const mixed={...western,sources:['CMM','Canal Extremadura']};

test('programas de CMM que ya no son taurinos salen del histórico',()=>{
 assert.equal(isRetiredCmmProgramme(western),true);
 assert.equal(isRetiredCmmProgramme(ancha),true);
});
test('el histórico taurino válido de CMM se conserva',()=>{
 assert.equal(isRetiredCmmProgramme(temporada),false);
 assert.equal(isRetiredCmmProgramme(tiempo),false);
 assert.equal(isRetiredCmmProgramme(toros2026),false);
 // Un festejo real guardado con la localidad como nombre (title null) no se evalúa como programa.
 assert.equal(isRetiredCmmProgramme(festejoCmm),false);
});
test('otras fuentes no se ven afectadas',()=>{
 assert.equal(isRetiredCmmProgramme(otherSource),false);
 assert.equal(isRetiredCmmProgramme({...otherSource,id:'cmm-falso',title:'LO MEJOR DEL OESTE'}),false);
 assert.equal(isRetiredCmmProgramme(mixed),false);
});
test('la siembra del histórico descarta solo los programas retirados y lo cuenta',()=>{
 const collection=[];
 const stats=seedHistoricalEvents(collection,[{events:[western,ancha,temporada,tiempo,toros2026,festejoCmm,otherSource]}],'2026-10-08');
 assert.equal(stats.retired,2);
 assert.deepEqual(collection.map(event=>event.id).sort(),[temporada.id,tiempo.id,toros2026.id,festejoCmm.id,otherSource.id].sort());
});
