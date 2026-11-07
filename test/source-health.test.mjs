import test from 'node:test';import assert from 'node:assert/strict';import { sourceHealth } from '../scrapers/source-health.mjs';
const now=Date.parse('2026-11-08T12:00:00Z');const good=()=>({ok:true,label:'Fuente',eventCount:0,fetchedAt:'2026-11-08T11:00:00Z',data:{events:[]}});
test('a fresh explicitly empty source is healthy',()=>assert.equal(sourceHealth(good(),now).status,'ok'));
test('old readable data is stale and retained',()=>{const s=good();s.fetchedAt='2026-08-01T00:00:00Z';s.data.events=[{id:'retained'}];const before=JSON.stringify(s);assert.equal(sourceHealth(s,now).status,'stale');assert.equal(JSON.stringify(s),before)});
test('unknown date is not successful verification',()=>{const s=good();s.fetchedAt=null;assert.equal(sourceHealth(s,now).status,'unverified')});
test('partial reader failure is not masked by readable JSON',()=>{const s=good();s.data.status='partial';s.data.errorCount=1;assert.equal(sourceHealth(s,now).status,'degraded')});
test('generatedAt can evidence a fresh successful reader',()=>{const s=good();s.data.generatedAt=s.fetchedAt;s.fetchedAt=null;assert.equal(sourceHealth(s,now).status,'ok')});
test('malformed events or missing file cannot be healthy',()=>{const s=good();delete s.data.events;assert.equal(sourceHealth(s,now).status,'error');s.ok=false;assert.equal(sourceHealth(s,now).status,'error')});
test('future reading date is not trusted',()=>{const s=good();s.fetchedAt='2027-01-01T00:00:00Z';assert.equal(sourceHealth(s,now).status,'unverified')});
