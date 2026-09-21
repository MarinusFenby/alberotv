import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractEventsFromBlocks, readIsolatedContentBlocks } from "../scrapers/lasventas.mjs";

function fakePage(contents = {}) {
  const requested = [];
  return {
    requested,
    locator(selector) {
      requested.push(selector);
      const values = contents[selector] || [];
      return { count: async () => values.length, allTextContents: async () => values };
    }
  };
}

test("Las Ventas no cruza el cartel con noticias ni paginación", () => {
  const blocks = [
    "Domingo 6 de septiembre a las 18:00 h. Toros de Pedraza de Yeltes para Francisco José Espada, Joaquín Galdós y Christian Parejo.",
    "ESTE JUEVES YA ESTÁN EN LAS VENTAS Los toros de Pedraza protagonistas 26/08/26 ACTUALIDAD NOTICIAS « 1 2 3 4 5 6 7 8 ... 162 163 »",
  ];
  const events = extractEventsFromBlocks(blocks, "https://www.las-ventas.com/actualidad");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].participants, ["Francisco José Espada", "Joaquín Galdós", "Christian Parejo"]);
  assert.equal(events[0].participants.some(value => /jueves|actualidad|162/i.test(value)), false);
});

test("el artículo estructurado recupera a Francisco José Espada sin cambiar de fecha", () => {
  const article = "miércoles 26 de agosto del 2026 Francisco José Espada, Joaquín Galdós y Christian Parejo son los tres nombres protagonistas de la cita de este jueves, 27 de agosto, a las 21h., en la Plaza de Toros de Las Ventas, para lidiar toros de Pedraza de Yeltes. VENTA DE ENTRADAS";
  const [event] = extractEventsFromBlocks([article], "https://www.las-ventas.com/actualidad/articulo");
  assert.equal(event.date, "2026-08-27");
  assert.equal(event.time, "21:00");
  assert.deepEqual(event.participants, ["Francisco José Espada", "Joaquín Galdós", "Christian Parejo"]);
  assert.equal(event.breeding, "Pedraza de Yeltes");
});

test("la plantilla real sin main usa #content .new-detail y excluye el resto de la página", async () => {
  const article = "Francisco José Espada, Joaquín Galdós y Christian Parejo son los tres nombres protagonistas de la cita de este jueves, 27 de agosto, a las 21h., para lidiar toros de Pedraza de Yeltes.";
  const page = fakePage({ "#content .new-detail": [article] });
  assert.deepEqual(await readIsolatedContentBlocks(page), [article]);
  assert.equal(page.requested.includes("body"), false);
  assert.equal(page.requested.includes("main"), false);
});

test("una plantilla con main procesa únicamente su article", async () => {
  const article = "Domingo 6 de septiembre a las 18:00 h. Toros de Pedraza de Yeltes para Tres Presentaciones.";
  const page = fakePage({ "main article": [article] });
  assert.deepEqual(await readIsolatedContentBlocks(page), [article]);
  assert.equal(page.requested.includes("body"), false);
});

test("una página individual sin contenedor reconocible se descarta inmediatamente", async () => {
  const page = fakePage({ body: ["cabecera navegación noticia paginación footer"] });
  assert.deepEqual(await readIsolatedContentBlocks(page), []);
  assert.equal(page.requested.includes("body"), false);
});

test("la página oficial de programación produce los cuatro festejos de septiembre", () => {
  const fixture = fs.readFileSync(new URL("./fixtures/lasventas-programacion-septiembre-2026.txt", import.meta.url), "utf8");
  const events = extractEventsFromBlocks([fixture], "https://www.las-ventas.com/actualidad/proximos-festejos-plaza-toros-las-ventas");
  assert.equal(events.length, 4, "una página oficial con programación válida nunca puede producir cero eventos");
  assert.deepEqual(events.map(({ date, time, type, breeding, participants }) => ({ date, time, type, breeding, participants })), [
    { date: "2026-09-06", time: "18:00", type: "Novillada", breeding: "Jiménez Pasquau, Ángel Luis Peña, La Machamona, Chamaco, Guadajira y José González", participants: ["Adrián Centenera", "Tomás González", "Andrés García"] },
    { date: "2026-09-13", time: "18:00", type: "Corrida de toros", breeding: "Valdellán y Juan Luis Fraile", participants: ["Pérez Mota", "Alberto Lamelas", "José Carlos Venegas"] },
    { date: "2026-09-20", time: "18:00", type: "Corrida de toros", breeding: "Veiga Teixeira y Partido de Resina", participants: ["Fermín Rivera", "Damián Castaño", "Gómez del Pilar"] },
    { date: "2026-09-27", time: "18:00", type: "Corrida de toros", breeding: "Saltillo, Palha, Castillejo de Huebra, Conde de la Corte, Pallarés y Valldellán", participants: ["Isaac Fonseca", "Cristian Pérez", "Alejandro Chicharro"] }
  ]);
});

test('programa mixto con fechas sin de no arrastra octubre al 27 de septiembre',()=>{
 const fixture=fs.readFileSync(new URL('./fixtures/lasventas-otono-2026.txt',import.meta.url),'utf8');
 const events=extractEventsFromBlocks([fixture],'https://www.las-ventas.com/actualidad/proximos-festejos-plaza-toros-las-ventas');
 assert.equal(events.length,12);
 const sep=events.find(e=>e.date==='2026-09-27');
 assert.equal(sep.type,'Corrida de toros');
 assert.deepEqual(sep.participants,['Isaac Fonseca','Cristian Pérez','Alejandro Chicharro']);
 assert.deepEqual(events.find(e=>e.date==='2026-10-01').participants,['El Mene','Nacho Torrejón','Mario Vilau']);
 assert.deepEqual(events.find(e=>e.date==='2026-10-10').participants,['Álvaro Serrano']);
 assert.deepEqual(events.find(e=>e.date==='2026-10-11').participants,['Antonio Ferrera','Román']);
 assert.equal(events.find(e=>e.date==='2026-10-09').time,'17:30');
 assert(events.every(e=>e.location==='Las Ventas (Madrid) España'));
 assert(events.every(e=>e.participants.every(p=>!/(octubre|septiembre|para|feria|18:00)/i.test(p))));
});

test('una descripción corregida conserva el ID del mismo día y hora',async()=>{
 const {preserveOfficialIds}=await import('../scrapers/lasventas.mjs');
 const event={id:'new',date:'2026-09-27',time:'18:00',participants:['A','B','C']};
 assert.equal(preserveOfficialIds([event],[{...event,id:'saved',participants:['bad']}])[0].id,'saved');
 assert.equal(preserveOfficialIds([event],[{...event,id:'other',time:'11:00'}])[0].id,'new');
 assert.equal(preserveOfficialIds([event],[{...event,id:'one'},{...event,id:'two'}])[0].id,'new');
});
