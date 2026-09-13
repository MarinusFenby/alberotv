import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readPdf, extractEvents} from '../scrapers/canalextremadura.mjs';
const bytes = new Uint8Array(await fs.readFile(new URL('./fixtures/canalextremadura-20260907.pdf',import.meta.url)));
const pdf = await readPdf('fixture', bytes);
const dates = Array.from({length:7},(_,i)=>`2026-09-${String(i+7).padStart(2,'0')}`);
test('PDF oficial: cinco bloques, horas de inicio, títulos completos y madrugada del lunes',()=>{
 const events=extractEvents(pdf.items,dates,'fixture',pdf.edges);
 assert.deepEqual(events.map(e=>[e.date,e.time]),[
  ['2026-09-08','18:15'],['2026-09-12','21:00'],['2026-09-13','13:00'],['2026-09-13','18:30'],['2026-09-14','02:30']
 ]);
 assert.match(events[1].title,/Almendralejo/);
 assert.match(events[3].title,/Higuera la Real/);
 assert.ok(events.every(e=>!e.title.includes('EXN2')));
});
test('no hay estimación por posición del título si faltan bordes',()=>{
 assert.throws(()=>extractEvents(pdf.items,dates,'fixture',[]),/aislar el bloque/);
});
test('madrugada cruza correctamente fin de mes y año',()=>{
 const days=['2026-12-25','2026-12-26','2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31'];
 assert.equal(extractEvents(pdf.items,days,'fixture',pdf.edges).at(-1).date,'2027-01-01');
});
test('mover el texto dentro de su celda no cambia la hora',()=>{
 const moved=pdf.items.map(i=>i.x>465&&i.y>590&&i.y<620?{...i,y:i.y-1}:i);
 assert.deepEqual(extractEvents(moved,dates,'fixture',pdf.edges),extractEvents(pdf.items,dates,'fixture',pdf.edges));
});
