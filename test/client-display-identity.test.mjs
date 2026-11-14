import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const [primary, secondary] = JSON.parse(fs.readFileSync(new URL('./fixtures/cinco-villas-display.json', import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(value);
function loadClient(events = []) {
  const storage = new Map(), writes = [];
  const context = vm.createContext({
    console: {warn() {}, error() {}}, Intl, Date,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {writes.push([key,value]); storage.set(key,value);}
    }
  });
  vm.runInContext('let loadedEvents = [];', context);
  vm.runInContext(source.slice(source.indexOf('function normalizeText'), source.indexOf('const SOURCE_TIME_ZONE')), context);
  const nonTvStart = source.indexOf('function isNonTelevisedEvent');
  vm.runInContext(source.slice(nonTvStart, source.indexOf('\nfunction ', nonTvStart + 1)), context);
  vm.runInContext(source.slice(source.indexOf('const FAVORITES_STORAGE_KEY'), source.indexOf('function encodeFavoriteEvent')), context);
  context.inputEvents = events;
  vm.runInContext('loadedEvents = inputEvents;', context);
  return {client: context, storage, writes};
}
const pair = () => [clone(primary), clone(secondary)];
const stable = (changes = {}) => ({...clone(primary), id:'ordinary-a', ...changes});
const favorite = (client, event, other = {}) => ({key:client.getFavoriteEventKey(event),label:'Original label',...other});
const empty = () => ({events:[],locations:[],channels:[],participants:[],breedings:[],programs:[]});

test('verified source aliases identify one dated event and preserve canonical material data in either order', () => {
  const {client:c} = loadClient();
  for (const input of [pair(), pair().reverse()]) {
    const before=plain(input), merged=c.deduplicateDisplayEvents(input);
    assert.equal(merged.length,1); const survivor=merged[0];
    for (const field of ['id','date','time','location','name','type','breeding','participants','sourceLocalDate','sourceLocalTime','sourceTimeZone','channel','televised'])
      assert.deepEqual(plain(survivor[field]),plain(primary[field]),field);
    assert.deepEqual(plain(input),before,'no mutation');
    assert.deepEqual(plain(survivor.sources),['Al Toro México','Mundotoro']);
    assert.equal(survivor.sourceDetails.length,2);
    assert.equal(c.getFavoriteEventKeys(survivor).length,2);
  }
});
test('merge is deterministic, repeated loads and serialized cache round trips are idempotent', () => {
  const {client:c}=loadClient();
  const a=c.deduplicateDisplayEvents(pair()), b=c.deduplicateDisplayEvents(pair().reverse());
  assert.deepEqual(plain(a),plain(b));
  assert.deepEqual(plain(c.deduplicateDisplayEvents(plain(a))),plain(a));
  const replay=c.deduplicateDisplayEvents([...plain(a),...pair()]);
  const again=c.deduplicateDisplayEvents([...plain(replay),...pair()]);
  assert.equal(replay.length,1); assert.deepEqual(plain(again),plain(replay));
});
test('a general fully specified identical event merges without a hardcoded event ID', () => {
  const {client:c}=loadClient();
  const a=stable(), b=stable({id:'ordinary-b', participants:[...primary.participants].reverse()});
  assert.equal(c.areSameBullfightingEvent(a,b),true);
  assert.equal(c.deduplicateDisplayEvents([a,b]).length,1);
});
test('distinct named arenas in one municipality stay separate', () => {
  const {client:c}=loadClient();
  const a=stable({location:'Monumental (Aguascalientes) México'});
  const b=stable({id:'other',location:'San Marcos (Aguascalientes) México'});
  assert.equal(c.areSameBullfightingEvent(a,b),false);
  assert.equal(c.areSameBullfightingEvent(stable({location:'Madrid (Las Ventas) España'}),stable({location:'Madrid (Palacio Vistalegre) España'})),false);
});
test('unverified lookalikes and cross-country names never acquire the venue alias', () => {
  const {client:c}=loadClient();
  for (const change of [
    {location:'Cinco Villas (Zaragoza) España',country:'España'},
    {location:'Santiago Cuautlapán (Otra plaza) (Estado de México) México'},
    {location:secondary.location,country:'Perú'},
    {location:'Plaza Cinco Villas B (Estado de México) México'}
  ]) assert.equal(c.areSameBullfightingEvent(primary,{...secondary,...change}),false);
});
test('contradictory date, type, cartel, herd, number and channel remain visible', () => {
  const {client:c}=loadClient();
  for (const change of [
    {date:'2026-11-16'}, {type:'Novillada con picadores'}, {participants:['Alejandro Talavante']},
    {participants:['Alejandro Talavante','Sergio Flores','Otro torero']}, {participants:[]},
    {participants:['Alejandro Talavante','Alejandro Talavante']}, {breeding:'Otra ganadería'},
    {breeding:''},{cattleCount:4}
  ]) assert.equal(c.deduplicateDisplayEvents([primary,{...secondary,...change}]).length,2,JSON.stringify(change));
  assert.equal(c.areSameBullfightingEvent({...primary,channel:'Canal A'}, {...secondary,channel:'Canal B'}),false);
});
test('two confirmed sessions stay separate; unknown times are not generic wildcards', () => {
  const {client:c}=loadClient();
  const early=stable(), late=stable({id:'late',sourceLocalTime:'17:00'});
  const unknown=stable({id:'unknown',sourceLocalTime:null});
  assert.equal(c.areSameBullfightingEvent(early,late),false);
  assert.equal(c.areSameBullfightingEvent(early,unknown),false);
  assert.equal(c.areSameBullfightingEvent(unknown,{...unknown,id:'other'}),false);
  for (const inputs of [[early,unknown,late],[unknown,late,early],[late,early,unknown]])
    assert.equal(c.deduplicateDisplayEvents(inputs).length,3);
});
test('a third contradictory record cannot bridge the verified pair into another session', () => {
  const {client:c}=loadClient();
  const later={...clone(primary),id:'third-session',sourceLocalTime:'17:00'};
  for (const input of [[primary,secondary,later],[later,secondary,primary],[secondary,later,primary]])
    assert.equal(c.deduplicateDisplayEvents(input).length,2);
});
test('local and legacy schedule conflict, invalid time or missing zone fail closed', () => {
  const {client:c}=loadClient();
  for (const change of [
    {time:'13:00'}, {sourceLocalTime:'25:00'}, {sourceTimeZone:'not/a-zone'},
    {sourceTimeZone:null}, {sourceLocalDate:'2026-02-30'}
  ]) assert.equal(c.areSameBullfightingEvent({...primary,...change},secondary),false,JSON.stringify(change));
  assert.equal(c.areSameBullfightingEvent({...primary,time:'20:00'},secondary),true);
});
test('civil time resolution rejects DST gaps and folds without inventing a time', () => {
  const {client:c}=loadClient();
  assert.equal(c.displayCivilInstant('2026-03-29','02:30','Europe/Madrid'),null);
  assert.equal(c.displayCivilInstant('2026-10-25','02:30','Europe/Madrid'),null);
  assert.equal(c.displayCivilInstant('2026-11-15','13:00','America/Mexico_City'),Date.parse('2026-11-15T19:00:00Z'));
});
test('identity uses venue-local day even when the legacy Madrid date is next day', () => {
  const {client:c}=loadClient();
  const a=stable({sourceLocalTime:'20:00'});
  const b=stable({id:'b',date:'2026-11-16',sourceLocalTime:'20:00',time:'03:00'});
  assert.equal(c.areSameBullfightingEvent(a,b),true);
  assert.equal(c.areSameBullfightingEvent(a,{...b,sourceLocalDate:'2026-11-16'}),false);
});
test('programme broadcasts are not folded into arena events', () => {
  const {client:c}=loadClient();
  assert.equal(c.areSameBullfightingEvent(primary,{...secondary,contentType:'programa'}),false);
});
test('old favorites from either card still select the survivor, with or without the secondary source present', () => {
  for (const inputs of [pair(),[clone(primary)]]) {
    const setup=loadClient(); const c=setup.client;
    const events=c.deduplicateDisplayEvents(inputs), survivor=events[0];
    for (const old of [primary,secondary]) {
      const f=favorite(c,old);
      assert.equal(c.favoriteEventMatches(f,survivor,events),true);
      const favorites={...empty(),events:[f]};
      assert.ok(c.eventMatchesFavorites(survivor,favorites).includes('este festejo'));
    }
  }
});
test('favorite migration is idempotent, retains original keys, labels, unrelated categories and every saved row', () => {
  const {client:c}=loadClient();
  const events=c.deduplicateDisplayEvents(pair());
  const original={...empty(),events:[favorite(c,primary,{extra:1}),favorite(c,secondary,{extra:2}),{key:'untouched',label:'Other'}],locations:['Original location'],channels:['Canal']};
  const before=plain(original), migrated=c.migrateFavoriteEvents(original,events);
  assert.equal(migrated.events.length,original.events.length);
  assert.equal(migrated.events[1].key,c.getFavoriteEventKey(primary));
  assert.deepEqual(plain(migrated.events[1].legacyKeys),[c.getFavoriteEventKey(secondary)]);
  assert.equal(migrated.events[1].label,'Original label');assert.equal(migrated.events[1].extra,2);
  assert.deepEqual(plain(migrated.locations),original.locations);
  assert.deepEqual(plain(migrated.channels),original.channels);
  assert.deepEqual(plain(c.migrateFavoriteEvents(migrated,events)),plain(migrated));
  assert.deepEqual(plain(original),before);
});
test('migration is suspended for ambiguous favorites or contradictory active source records', () => {
  const {client:c}=loadClient();
  const bad={...secondary,participants:['Someone else']};
  const old={...empty(),events:[favorite(c,secondary)]};
  assert.deepEqual(plain(c.migrateFavoriteEvents(old,[primary,bad])),plain(old));
  assert.equal(c.favoriteEventMatches(old.events[0],primary,[primary,bad]),false);
});
test('explicit uncheck removes every alias of that event only; selecting does not discard other favorites', () => {
  const {client:c}=loadClient();const events=c.deduplicateDisplayEvents(pair());
  const old={...empty(),events:[favorite(c,primary),favorite(c,secondary),{key:'other',label:'Other'}]};
  const off=c.setEventFavorite(old,events[0],false,events);
  assert.deepEqual(plain(off.events),[{key:'other',label:'Other'}]);
  const on=c.setEventFavorite(old,events[0],true,events);
  assert.equal(on.events.length,2);assert.equal(c.favoriteEventMatches(on.events[1],secondary,events),true);
  assert.deepEqual(plain(c.setEventFavorite(on,events[0],true,events)),plain(on));
});
test('venue favorites from both original spellings still match without rewriting saved place text', () => {
  const {client:c}=loadClient();
  for (const old of [primary.location,secondary.location]) {
    const f={...empty(),locations:[old]};
    assert.ok(c.eventMatchesFavorites(primary,f).some(value=>value.startsWith('la plaza de ')));
    assert.equal(f.locations[0],old);
  }
  assert.equal(c.favoriteLocationMatches([secondary.location],{...primary,location:'Otra plaza (Texcoco) México'}),false);
});
test('getFavorites persists a migration once and never loses readable data if saving is blocked', () => {
  const {client:c,storage,writes}=loadClient([primary]);
  const old={...empty(),events:[favorite(c,secondary)]};
  storage.set('alberotv-favorites-v1',JSON.stringify(old));
  const a=c.getFavorites(),b=c.getFavorites();
  assert.equal(writes.length,1);assert.deepEqual(plain(a),plain(b));
  storage.set('alberotv-favorites-v1',JSON.stringify(old));
  c.localStorage.setItem=()=>{throw new Error('quota');};
  const blocked=c.getFavorites();
  assert.equal(blocked.events.length,1);assert.equal(blocked.events[0].key,c.getFavoriteEventKey(primary));
  assert.deepEqual(JSON.parse(storage.get('alberotv-favorites-v1')),old);
});
test('actual favorites UI reads and saves through alias-aware helpers', () => {
  const read=source.slice(source.indexOf('function openFavoritesSheet('),source.indexOf('function closeFavoritesSheet('));
  const save=source.slice(source.indexOf('async function saveFavoriteSelections('),source.indexOf('function updateFavoriteButtons('));
  assert.match(read,/favoriteEventMatches\(favorite, event\)/);
  assert.match(read,/favoriteLocationMatches\(favorites\.locations, event\)/);
  assert.match(save,/setEventFavorite\(\s*favorites, pendingFavoriteEvent/);
  assert.match(save,/getFavoriteEventLocations\(pendingFavoriteEvent\)/);
});


test('explicit venue identifiers override identical labels and prevent accidental arena fusion', () => {
  const {client:c}=loadClient();
  for (const field of ['venueId','arenaId','bullringId','plazaId']) {
    const a=stable({[field]:'ring-one'}),b=stable({id:'b',[field]:'ring-two'});
    assert.equal(c.areSameBullfightingEvent(a,b),false,field);
    assert.equal(c.deduplicateDisplayEvents([a,b]).length,2,field);
  }
});
test('cancellations, postponements, reschedules and delayed broadcasts cannot be hidden by dedupe', () => {
  const {client:c}=loadClient();
  for (const change of [
    {cancelled:true,status:'cancelled'},{canceled:true,status:'canceled'},
    {postponed:true,status:'postponed'},{rescheduled:true,status:'rescheduled'},
    {status:'completed'},{deferred:true},{rescheduledFrom:'2026-11-14'},
    {lifecycleStatus:'cancelled'}, {cancelled:true,status:'confirmed'}
  ]) assert.equal(c.deduplicateDisplayEvents([stable(),stable({id:'b',...change})]).length,2,JSON.stringify(change));
  const a=stable({cancelled:true,status:'cancelled'}),b=stable({id:'b',cancelled:true,status:'cancelled'});
  assert.equal(c.areSameBullfightingEvent(a,b),true);
});
test('explicit no-TV versus broadcast and two channels remain separate for TV filters', () => {
  const {client:c}=loadClient();
  const onTv={...secondary,channel:'Canal X',televised:true};
  assert.equal(c.deduplicateDisplayEvents([primary,onTv]).length,2);
  assert.equal(c.deduplicateDisplayEvents([onTv,primary]).length,2);
  assert.equal(c.areSameBullfightingEvent(stable({channel:'Canal X',televised:false}),stable({id:'b',channel:'Canal X',televised:false})),false);
});
test('alias favorite recovery stops when a peer has explicit venue, lifecycle or TV conflict', () => {
  const {client:c}=loadClient();
  for (const patch of [{venueId:'other'}, {cancelled:true,status:'cancelled'}, {channel:'Canal X',televised:true}]) {
    const a={...primary,venueId:'main'}, b={...secondary,...patch};
    const f=favorite(c,secondary);
    assert.equal(c.favoriteEventMatches(f,a,[a,b]),false,JSON.stringify(patch));
  }
});
test('favorite-manager removal accepts a legacy key after read migration and removes only the intended event', () => {
  const {client:c}=loadClient();
  const events=c.deduplicateDisplayEvents(pair());
  const original={...empty(),events:[favorite(c,primary),favorite(c,secondary),{key:'other',label:'Other'}]};
  const migrated=c.migrateFavoriteEvents(original,events);
  const removed=c.removeFavoriteEventByKey(migrated,c.getFavoriteEventKey(secondary),events);
  assert.deepEqual(plain(removed.events),[{key:'other',label:'Other'}]);
  const src=source.slice(source.indexOf('async function removeFavoriteFromManager('),source.indexOf('async function deleteAllFavorites('));
  assert.match(src,/removeFavoriteEventByKey\(favorites, eventKey\)/);
});


test('suspension, deletion/tombstones and malformed lifecycle flags cannot disappear in a merge', () => {
  const {client:c}=loadClient();
  for (const patch of [
    {suspended:true},{isSuspended:true},{status:'suspended'}, {deleted:true},{isDeleted:true},
    {status:'deleted'},{removed:true},{tombstone:true},{status:'tombstone'},
    {archived:true},{deletedAt:'2026-11-14T10:00:00Z'},{suspendedAt:'2026-11-14T10:00:00Z'},
    {cancelled:'true'}, {deleted:'false'}
  ]) {
    const a=stable(), b=stable({id:'b',...patch});
    assert.equal(c.deduplicateDisplayEvents([a,b]).length,2,JSON.stringify(patch));
    assert.equal(c.deduplicateDisplayEvents([b,a]).length,2,JSON.stringify(patch));
  }
});


test('repainting a full calendar migrates once per storage/snapshot, returns independent values and invalidates correctly', () => {
  const all=JSON.parse(fs.readFileSync(new URL('../data/programacion.json',import.meta.url),'utf8')).events;
  const setup=loadClient(),c=setup.client;
  c.inputEvents=c.deduplicateDisplayEvents(all);
  vm.runInContext('loadedEvents = inputEvents;',c);
  const old={...empty(),events:[favorite(c,secondary)]};
  setup.storage.set('alberotv-favorites-v1',JSON.stringify(old));
  const original=c.migrateFavoriteEvents;let calls=0;
  c.migrateFavoriteEvents=(...args)=>{calls++;return original(...args);};
  for (let i=0;i<all.length;i++) assert.equal(c.getFavorites().events.length,1);
  assert.equal(calls,1);assert.equal(setup.writes.length,1);
  const returned=c.getFavorites();returned.events.length=0;
  assert.equal(c.getFavorites().events.length,1);
  c.saveFavorites({...empty(),events:[favorite(c,primary)]});
  c.getFavorites();assert.equal(calls,2);
  c.inputEvents=[primary];vm.runInContext('loadedEvents = inputEvents;',c);
  c.getFavorites();assert.equal(calls,3);
  setup.storage.set('alberotv-favorites-v1',JSON.stringify({...empty(),events:[{key:'unrelated',label:'New'}]}));
  assert.equal(c.getFavorites().events[0].key,'unrelated');assert.equal(calls,4);
});


test('persisted migrated aliases lose matching and removal authority after sources conflict', () => {
  const {client:c}=loadClient();
  const merged=c.deduplicateDisplayEvents(pair());
  const migrated=plain(c.migrateFavoriteEvents({...empty(),events:[favorite(c,secondary),{key:'other',label:'Other'}]},merged));
  const keyA=c.getFavoriteEventKey(primary), keyB=c.getFavoriteEventKey(secondary);
  assert.equal(migrated.events[0].key,keyA);
  assert.deepEqual(migrated.events[0].legacyKeys,[keyB]);
  for (const patch of [
    {venueId:'other'}, {participants:['Other person']}, {breeding:'Other herd'},
    {sourceLocalTime:'17:00',sourceTimeZone:'America/Mexico_City'},
    {cancelled:true,status:'cancelled'}, {deleted:true}, {deferred:true}, {channel:'Canal X',televised:true}
  ]) {
    const a={...clone(primary),venueId:'main'}, b={...clone(secondary),...patch};
    const events=c.deduplicateDisplayEvents([a,b]);
    assert.equal(events.length,2,JSON.stringify(patch));
    assert.equal(c.favoriteEventMatches(migrated.events[0],a,events),true);
    assert.equal(c.favoriteEventMatches(migrated.events[0],b,events),false,JSON.stringify(patch));
    assert.deepEqual(plain(c.setEventFavorite(migrated,b,false,events)),migrated,'unchecking conflict retains canonical favorite');
    assert.deepEqual(plain(c.removeFavoriteEventByKey(migrated,keyB,events)),migrated,'manager cannot remove canonical favorite via stale alias');
    assert.deepEqual(plain(c.migrateFavoriteEvents(migrated,events)),migrated,'migration is stable after conflict');
  }
  assert.deepEqual(plain(c.removeFavoriteEventByKey(migrated,keyB,[])),migrated,'no live owner does not revive stale authority');
  assert.deepEqual(plain(c.removeFavoriteEventByKey(migrated,keyA,[]).events),[{key:'other',label:'Other'}]);
  assert.equal(c.favoriteEventMatches(migrated.events[0],secondary,merged),true,'valid dated proof restores alias matching');
  assert.deepEqual(plain(c.setEventFavorite(migrated,merged[0],false,merged).events),[{key:'other',label:'Other'}]);
});

test('selecting a newly conflicting source creates an independent favorite and unchecking preserves the other', () => {
  const {client:c}=loadClient();
  const valid=c.deduplicateDisplayEvents(pair());
  const migrated=plain(c.migrateFavoriteEvents({...empty(),events:[favorite(c,secondary)]},valid));
  const a={...clone(primary),venueId:'main'},b={...clone(secondary),venueId:'other'},events=[a,b];
  const selected=plain(c.setEventFavorite(migrated,b,true,events));
  assert.equal(selected.events.length,2);
  assert.ok(selected.events.some(f=>f.key===c.getFavoriteEventKey(primary)));
  assert.ok(selected.events.some(f=>f.key===c.getFavoriteEventKey(secondary)));
  assert.deepEqual(plain(c.setEventFavorite(selected,b,false,events)),migrated);
});


test('unknown and malformed lifecycle states cannot be absorbed as missing status', () => {
  const {client:c}=loadClient();
  for (const field of ['status','eventStatus','lifecycleStatus']) {
    for (const value of [123,0,false,[],{},'annulled','withdrawn','not-recognized']) {
      const a=stable({id:'a',status:'confirmed'}),b=stable({id:'z',[field]:value});
      assert.equal(c.areSameBullfightingEvent(a,b),false,`${field}: ${JSON.stringify(value)}`);
      assert.equal(c.deduplicateDisplayEvents([a,b]).length,2);
      assert.equal(c.deduplicateDisplayEvents([b,a]).length,2);
    }
    for (const value of [undefined,null,'','  ']) {
      const a=stable({id:'a',status:'confirmed'}),b=stable({id:'z',[field]:value});
      assert.equal(c.areSameBullfightingEvent(a,b),true,`${field}: omitted or empty`);
    }
  }
});
