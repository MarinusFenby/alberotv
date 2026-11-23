const reviewed=[
 [
  "mundotoro-faceb260332275",
  "altoromexico-cecc051513661b",
  "2026-11-27",
  "20:00",
  "San Miguel de Allende (Guanajuato) México",
  "Javier Garfias, Santín",
  [
   "Emiliano Gamero",
   "Octavio García El Payo",
   "Andrés Roca Rey"
  ],
  "Corrida mixta",
  "6 toros anunciados: 2 de Javier Garfias para rejones y 4 de Santín para la lidia a pie.",
  "https://www.altoromexico.com/index.php?acc=noticiad&id=53097"
 ],
 [
  "mundotoro-54fa6234b467f9",
  "altoromexico-db2563832b1be5",
  "2026-11-28",
  "17:00",
  "León (Guanajuato) México",
  "Villacarmela",
  [
   "Diego Silveti",
   "Fermín Espinosa Armillita IV",
   "Andrés Roca Rey"
  ],
  "Corrida de toros",
  "6 toros anunciados de Villa Carmela.",
  "https://www.emsa.mx/event-details/1er-festejo-en-plaza-de-toros-la-luz-leon"
 ]
];
const atm='https://www.altoromexico.com/index.php?acc=carteleria';
// Offline isolated candidate. Uses source fields and fixed reviewed scope, never a generic count inference.
export function projectLateNovemberGuanajuato(events,atmEvents){
 const replacements=new Map(),audit=[];
 for(const [fallback,rawId,date,time,location,breeding,roster,type,description,publicRef] of reviewed){
  const isTarget=x=>x?.location===location&&x?.date===date&&x?.contentType==='festejo';
  const fixed=x=>isTarget(x)&&x.sourceLocalDate===date&&x.sourceLocalTime===time&&
    x.sourceTimeZone==='America/Mexico_City'&&x.breeding===breeding&&JSON.stringify(x.participants)===JSON.stringify(roster);
  const target=events.filter(x=>[fallback,rawId].includes(x.id)||isTarget(x));
  if(!target.length){audit.push([fallback,'absent']);continue;}
  const source=atmEvents.filter(x=>x.id===rawId||isTarget(x));
  const prev=target[0],evidence=source[0];
  if(target.length!==1||![fallback,rawId].includes(prev.id)||!fixed(prev)||
     !['Corrida de toros',type].includes(prev.type)||![null,undefined,6].includes(prev.cattleCount)||
     !(prev.description==null||prev.description===description)||source.length!==1||
     evidence.id!==rawId||!fixed(evidence)||evidence.cattleCount!==6||evidence.sourceUrl!==atm||
     !Array.isArray(prev.sources)||!prev.sources.includes('Al Toro México')){
   audit.push([fallback,'needs_review']);continue;
  }
  if(prev.type===type&&prev.cattleCount===6&&prev.description===description){audit.push([fallback,'already_correct']);continue;}
  replacements.set(prev,{...prev,type,cattleCount:6,description,
   fieldSources:{...prev.fieldSources,cattleCount:'Al Toro México',description:'Al Toro México',
    ...(type!==prev.type?{type:'Al Toro México'}:{})}});
  audit.push([fallback,'projected',publicRef]);
 }
 return {events:events.map(e=>replacements.get(e)||e),audit};
}
