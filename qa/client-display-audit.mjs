import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const baseCommit='45147ea119a2471778bb5d514db8329900a7cdfa';
const source=fs.readFileSync('script.js','utf8');
const baseline=execFileSync('git',['show',baseCommit+':script.js'],{encoding:'utf8'});
const inputBytes=fs.readFileSync(process.argv[2]||'data/programacion.json');
const input=JSON.parse(inputBytes);
function load(s) {
 const c=vm.createContext({});
 vm.runInContext(s.slice(s.indexOf('function normalizeText'),s.indexOf('const SOURCE_TIME_ZONE')),c);
 const n=s.indexOf('function isNonTelevisedEvent');
 vm.runInContext(s.slice(n,s.indexOf('\nfunction ',n+1)),c);
 return c;
}
const start=performance.now(),previous=load(baseline).deduplicateDisplayEvents(input.events);
const previousMs=performance.now()-start,nextStart=performance.now(),current=load(source).deduplicateDisplayEvents(input.events);
const currentMs=performance.now()-nextStart;
const oldById=new Map(previous.map(e=>[e.id,e])),newById=new Map(current.map(e=>[e.id,e]));
const newlyVisible=current.filter(e=>!oldById.has(e.id)).map(e=>({id:e.id,date:e.date,location:e.location}));
const removedDuplicate=previous.filter(e=>!newById.has(e.id)).map(e=>({id:e.id,date:e.date,location:e.location}));
const changed=current.flatMap(e=>{
 const before=oldById.get(e.id);if(!before)return [];
 const fields=[...new Set([...Object.keys(before),...Object.keys(e)])].filter(k=>JSON.stringify(before[k])!==JSON.stringify(e[k]));
 return fields.length?[{id:e.id,fields}]:[];
});
console.log(JSON.stringify({
 checkedAt:new Date().toISOString(),baseCommit,inputGeneratedAt:input.generatedAt,
 inputSha256:crypto.createHash('sha256').update(inputBytes).digest('hex'),
 scriptSha256:crypto.createHash('sha256').update(source).digest('hex'),
 input:input.events.length,previous:previous.length,current:current.length,
 previousMs,currentMs,newlyVisible,removedDuplicate,changed
},null,2));
