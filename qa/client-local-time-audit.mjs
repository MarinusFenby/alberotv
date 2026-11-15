import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const baseCommit = process.argv[3] || 'fd89002747feb313164c7f360bb3d0833198fd06';
const baseline = execFileSync('git', ['show', `${baseCommit}:script.js`], {encoding: 'utf8'});
const source = fs.readFileSync('script.js', 'utf8');
const inputBytes = fs.readFileSync(process.argv[2] || 'data/programacion.json');
const input = JSON.parse(inputBytes);
const plain = value => JSON.parse(JSON.stringify(value));
function load(text, zone) {
  const context = vm.createContext({Intl, Date});
  vm.runInContext(text.slice(text.indexOf('function escapeHtml'), text.indexOf('function getLocalCalendarDifference'))
    .replace('const USER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";',
      `const USER_TIME_ZONE = ${JSON.stringify(zone)};`), context);
  const start = text.indexOf('function isNonTelevisedEvent');
  vm.runInContext(text.slice(start, text.indexOf('\nfunction ', start + 1)), context);
  return context;
}
const zones = ['Europe/Madrid', 'America/Merida', 'America/Tijuana', 'UTC', 'Asia/Tokyo'];
const zonesChecked = zones.map(zone => {
  const before = load(baseline, zone), after = load(source, zone);
  const legacy = input.events.filter(event => event.time && !event.sourceLocalTime);
  const unknown = input.events.filter(event => !event.time && !event.sourceLocalTime);
  const local = input.events.filter(event => event.sourceLocalTime);
  for (const event of legacy) {
    assert.deepEqual(plain(after.getEventTimePresentation(event)), plain(before.getEventTimePresentation(event)), `${zone}: ${event.id}`);
    assert.equal(after.getEventStartInstant(event)?.getTime(), before.getEventStartInstant(event)?.getTime(), `${zone}: ${event.id}`);
  }
  for (const event of unknown)
    assert.deepEqual(plain(after.getEventTimePresentation(event)), plain(before.getEventTimePresentation(event)), `${zone}: ${event.id}`);
  assert.deepEqual(plain(after.deduplicateDisplayEvents(input.events)), plain(before.deduplicateDisplayEvents(input.events)), 'identity/order/material data');
  return {
    zone, unchangedLegacy: legacy.length, unchangedUnknown: unknown.length,
    localSchedules: local.length, localNowResolved: local.filter(event => after.hasValidEventTime(event)).length,
    unresolvedLocalIds: local.filter(event => !after.hasValidEventTime(event)).map(event => event.id)
  };
});
console.log(JSON.stringify({
  baseCommit, inputGeneratedAt: input.generatedAt, inputEvents: input.events.length,
  inputSha256: crypto.createHash('sha256').update(inputBytes).digest('hex'),
  scriptSha256: crypto.createHash('sha256').update(source).digest('hex'),
  inputUnchanged: JSON.stringify(input) === JSON.stringify(JSON.parse(inputBytes)),
  identityOrderAndMaterialDataUnchanged: true, zonesChecked
}, null, 2));
