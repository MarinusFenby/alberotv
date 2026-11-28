import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const verified = new URL('../data/programas-taurinos-verificados.json', import.meta.url);
const source = new URL('../scrapers/programas-taurinos.mjs', import.meta.url);
const read = name => JSON.parse(readFileSync(name, 'utf8'));
const reference = read(verified);

function isolated(fn) {
  const cwd=mkdtempSync(path.join(os.tmpdir(), 'alberotv-programas-'));
  try {
    mkdirSync(path.join(cwd,'data'));mkdirSync(path.join(cwd,'scrapers'));
    const input=path.join(cwd,'data/programas-taurinos-verificados.json');
    copyFileSync(verified,input);
    copyFileSync(source,path.join(cwd,'scrapers/programas-taurinos.mjs'));
    writeFileSync(path.join(cwd,'mock.mjs'), `
      const NativeDate = Date;
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [process.env.TEST_TV_NOW])); }
        static now() { return NativeDate.parse(process.env.TEST_TV_NOW); }
      };
      globalThis.fetch = async url => {
        if (String(url) !== 'https://www.canalsur.es/guia-programacion/canal-sur-television-79/') throw Error('Unexpected network');
        return new Response('13:05 Toros para Todos');
      };
    `);
    const run=(date='2026-11-28T14:00:00Z')=>{
      execFileSync(process.execPath,['--import','./mock.mjs','scrapers/programas-taurinos.mjs'],{cwd,env:{...process.env,TEST_TV_NOW:date},stdio:'pipe'});
      return read(path.join(cwd,'data/programas-taurinos.json'));
    };
    fn(run,input);
  } finally { rmSync(cwd,{recursive:true,force:true}); }
}

test('two Canal Sur refreshes keep each exact dated programme without duplicating it',()=>isolated(run=>{
  const first=run(), second=run();
  assert.equal(first.emissionsFound,16);
  assert.deepEqual(second,first);
  const ids=reference.events.map(row=>row.id);
  assert.deepEqual(first.events.filter(row=>ids.includes(row.id)),reference.events);
  assert.equal(new Set(first.events.map(row=>row.id)).size,16);
  assert.equal(first.diagnostics.filter(d=>d.eventIds).length,3);
}));

test('verified slots expire by civil date in Spain and are not projected',()=>isolated(run=>{
  const events=run('2026-11-28T23:05:00Z').events;
  assert.deepEqual(events.filter(e=>e.source!=='Canal Sur'),reference.events.filter(e=>e.date==='2026-11-29'));
  assert.equal(run('2026-11-29T23:05:00Z').events.filter(e=>e.source!=='Canal Sur').length,0);
}));

test('duplicates or invalid times stop before overwriting the last good artifact',()=>isolated((run,input)=>{
  const previous=run();
  const first=reference.events[0];
  for(const events of [[first,first],[{...first,time:'99:01'}]]) {
    writeFileSync(input,JSON.stringify({events}));
    assert.throws(run);
    assert.deepEqual(read(path.join(path.dirname(input),'programas-taurinos.json')),previous);
  }
}));
