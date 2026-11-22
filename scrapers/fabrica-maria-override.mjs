import {createHash} from 'node:crypto';
const canonical='altoromexico-24b277d8421718';
const rawId='mundotoro-e9a1ea459ea7f4';
const reviewedIds=new Set([canonical,rawId]);
const prior='2026-11-26', target='2026-12-26', hour='16:00', zone='America/Mexico_City';
const toreros=['Emiliano Gamero','Juan Pablo Sánchez','Jesús Sosa'];
const group='Forcados Amadores de México';
const venue='Plaza de Toros Silverio Pérez';
const announce={id:'forcados-amadores-de-mexico',entityType:'collective',role:'forcados',participationStatus:'announced',displayName:group};
const evidence={
  sourceUrl:'https://www.altoromexico.com/?acc=noticiad&id=53137',
  corroboratingUrl:'https://www.aplausos.es/cartel/sabado-26-de-diciembre-de-2026/amp/',
  venue,formerPublishedDate:prior,verifiedLocalDate:target,verifiedLocalTime:hour,sourceTimeZone:zone,
  priorFallbackEventId:rawId,canonicalApiId:canonical,checkedOn:'2026-11-22'
};
const norm=(v)=>String(v??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
const places=new Set(['fabrica maria (estado de mexico) mexico','fabrica maria (otzolotepec) (estado de mexico) mexico']);
const listEqual=(a,b)=>Array.isArray(a) && a.length===b.length&&a.map(norm).sort().every((x,i)=>x===b.map(norm).sort()[i]);
const scope=e=>e && [prior,target].includes(e.date) && places.has(norm(e.location||e.name))&&e.contentType==='festejo'&&
  norm(e.country)==='mexico'&&norm(e.type)==='corrida de toros'&&norm(e.breeding)==='la estancia'&&
  (listEqual(e.participants,toreros)||listEqual(e.participants,[...toreros,group]));
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])) : x;
export const exactSha=x=>createHash('sha256').update(JSON.stringify(ordered(x))).digest('hex');
const same=(a,b)=>exactSha(a)===exactSha(b);
const blocked=(events,reason)=>({events,status:'blocked',reason});
const knownFeeds=new Set(['https://www.altoromexico.com/index.php?acc=carteleria','https://www.mundotoro.com/carteles-taurinos']);
const allowedDates=new Set([prior,target]);
const approvedNewFeed=e=>e.date===target&&/^(?:altoromexico|mundotoro)-[a-f0-9]{14}$/.test(e.id)&&knownFeeds.has(e.sourceUrl);
const noneOr=(actual,expected)=>actual==null||actual===expected;
const presented=e=>e.id===canonical&&e.date===target&&e.sourceLocalDate===target&&e.sourceLocalTime===hour&&e.sourceTimeZone===zone&&e.venue===venue&&e.cattleCount===6&&listEqual(e.participants,toreros)&&same(e.collectiveParticipants,[announce])&&same(e.agendaDateCorrection,evidence);
const compatibleBase=e=>noneOr(e.sourceLocalDate,e.date)&&noneOr(e.sourceLocalTime,hour)&&noneOr(e.sourceTimeZone,zone)&&
  e.time==null&&(e.venue==null||norm(e.venue)===norm(venue))&&noneOr(e.cattleCount,6)&&
  (e.collectiveParticipants==null||same(e.collectiveParticipants,[announce]))&&e.agendaDateCorrection==null;
const oldBound=e=>e.date===prior&&reviewedIds.has(e.id)&&knownFeeds.has(e.sourceUrl)&&compatibleBase(e);
export function projectFabricaMariaCorrection(events) {
  const ids=events.filter(e=>reviewedIds.has(e?.id)&&allowedDates.has(e.date));
  const twins=events.filter(scope);
  if(ids.length===0&&twins.length===0)return {events,status:'out_of_scope'};
  if(twins.length<1||twins.length>2||ids.some(x=>!twins.includes(x)))return blocked(events,'identity_collision_or_drift');
  let current=twins[0], retired=[];
  if(twins.length===2){
   const old=twins.filter(oldBound), dec=twins.filter(e=>presented(e)||approvedNewFeed(e)&&compatibleBase(e));
   if(old.length!==1||dec.length!==1||old[0]===dec[0])return blocked(events,'unproved_cross_date_pair');
   current=dec[0];retired=old;
  }
  if(presented(current)&&retired.length===0)return {events,status:'already_current'};
  if(!(presented(current)||oldBound(current)||approvedNewFeed(current)&&compatibleBase(current)))return blocked(events,'unverified_source_or_fields');
  const next=presented(current)?current:{...current,id:canonical,date:target,sourceLocalDate:target,sourceLocalTime:hour,sourceTimeZone:zone,
      venue,cattleCount:6,participants:[...toreros],collectiveParticipants:[{...announce}],agendaDateCorrection:{...evidence},
      fieldSources:{...current.fieldSources,date:'Cartel de organización, corroborado por Aplausos',
       localTime:'Cartel de organización, corroborado por Aplausos',participants:'Cartel de organización',
       collectiveParticipants:'Cartel de organización',cattleCount:'Cartel de organización',venue:'Cartel de organización'}};
  const nextRows=events.filter(e=>!retired.includes(e)).map(e=>e===current?next:e);
  if(nextRows.filter(e=>e.id===canonical).length!==1)return blocked(events,'public_id_collision');
  const retiredBefore=retired.map(row=>({index:events.indexOf(row),row:structuredClone(row),sha256:exactSha(row)}));
  return {status:'applied',events:nextRows,receipt:{before:structuredClone(current),afterSha256:exactSha(next),beforeSha256:exactSha(current),canonicalId:canonical,retiredBefore}};
}
export function rollbackFabricaMariaExact(events, receipt){
  if(!receipt||!scope(receipt?.before)||receipt.canonicalId!==canonical||
     ![prior,target].includes(receipt.before.date)||receipt.beforeSha256!==exactSha(receipt.before))return blocked(events,'before_image_unverified');
  const ids=events.filter(e=>reviewedIds.has(e?.id));
  if(ids.length!==1||ids[0].id!==canonical||!scope(ids[0])||ids[0].date!==target||
     exactSha(ids[0])!==receipt.afterSha256||events.filter(scope).length!==1)return blocked(events,'rollback_cas_conflict');
  const extra=receipt.retiredBefore??[];
  if(!Array.isArray(extra)||extra.length>1||extra.some(x=>!oldBound(x.row)||exactSha(x.row)!==x.sha256||!Number.isSafeInteger(x.index)||x.index<0||x.index>events.length))return blocked(events,'retired_before_image_unverified');
  const next=events.map(e=>e===ids[0]?structuredClone(receipt.before):e);
  for(const r of extra)next.splice(r.index,0,structuredClone(r.row));
  return {status:'rolled_back',events:next};
}

