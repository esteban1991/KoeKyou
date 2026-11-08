// Guardado incremental: solo viaja el audio nuevo, con verificación de hash y limpieza de bloques huérfanos.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {chromium} from "playwright";
const API="http://127.0.0.1:8000/projects";
const pcm=(seconds,value)=>new Float32Array(48000*seconds).fill(value);
const sha=data=>createHash("sha256").update(Buffer.from(data.buffer)).digest("hex");
const track=(id,data)=>({id,name:id,hash:sha(data),channels:1,frames:data.length});
async function put(id,tracks,blobs=[]){
 const form=new FormData();form.append("manifest",JSON.stringify({name:"Incremental",tracks}));
 for(const data of blobs)form.append("blobs",new Blob([data.buffer]),sha(data));
 const response=await fetch(API+"/"+id,{method:"PUT",body:form});
 return {status:response.status,body:await response.json()};
}
const a=pcm(1,.1),b=pcm(2,.2),id=randomUUID();
let r=await put(id,[track("a",a)],[a]);assert.equal(r.status,200);assert.equal(r.body.uploaded,1);
// Mover o renombrar no reenvía audio: basta el manifiesto.
r=await put(id,[{...track("a",a),offset:3,name:"movido"}]);assert.equal(r.status,200);assert.equal(r.body.uploaded,0);
// Un bloque desconocido sin subir: 409 con la lista para reenviarlo.
r=await put(id,[track("a",a),track("b",b)]);assert.equal(r.status,409);assert.deepEqual(r.body.detail.missing,[sha(b)]);
r=await put(id,[track("a",a),track("b",b)],[b]);assert.equal(r.status,200);assert.equal(r.body.uploaded,1);
// El hash debe corresponder al contenido.
const form=new FormData();form.append("manifest",JSON.stringify({name:"x",tracks:[track("c",pcm(1,.3))]}));form.append("blobs",new Blob([pcm(1,.4).buffer]),sha(pcm(1,.3)));
assert.equal((await fetch(API+"/"+id,{method:"PUT",body:form})).status,422);
// Duplicar comparte bloques; quitar un segmento de ambos proyectos lo borra del servidor.
const copy=(await(await fetch(API+"/"+id+"/duplicate",{method:"POST"})).json()).id;
assert.equal(new Float32Array(await(await fetch(API+"/"+copy+"/blobs/"+sha(b))).arrayBuffer())[0],b[0]);
await put(id,[track("a",a)]);
assert.equal((await fetch(API+"/"+copy+"/blobs/"+sha(b))).status,200);
await put(copy,[track("a",a)]);
r=await put(id,[track("a",a),track("b",b)]);assert.equal(r.status,409,"el bloque huérfano debe haberse borrado");
console.log("PASS API: solo audio nuevo, 409 para reenviar, hash verificado, duplicado sin copia y limpieza de huérfanos");

// En el navegador: tras mover un segmento, el guardado no vuelve a subir su audio.
const browser=await chromium.launch({channel:"chrome"}),page=await browser.newPage();
await page.addInitScript(()=>{const original=window.fetch;window.__uploads=[];window.fetch=(url,options)=>{if(options?.method==="PUT"&&options.body instanceof FormData)window.__uploads.push(options.body.getAll("blobs").length);return original(url,options);};});
await page.goto("http://localhost:5173");
const saved=()=>page.waitForFunction(()=>document.querySelector('[data-testid="save-status"]')?.textContent==="Guardado localmente"&&!document.querySelector('select[aria-label="Abrir proyecto"]')?.disabled);
await saved();
await page.locator(".menu-popover").evaluate(el=>el.closest("details").open=true);
await page.getByRole("button",{name:"Nuevo proyecto"}).click();await saved();
const wav=(()=>{const n=48000,buffer=Buffer.alloc(44+n*2);buffer.write("RIFF",0);buffer.writeUInt32LE(36+n*2,4);buffer.write("WAVEfmt ",8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(48000,24);buffer.writeUInt32LE(96000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write("data",36);buffer.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)buffer.writeInt16LE(Math.round(Math.sin(i/20)*8000),44+i*2);return buffer;})();
await page.locator('input[type=file][multiple]').setInputFiles({name:"voz.wav",mimeType:"audio/wav",buffer:wav});
await page.waitForFunction(()=>document.querySelectorAll(".audio-track").length===1);await saved();
await page.evaluate(()=>{window.__uploads=[];});
await page.getByLabel("Posición (s)").fill("4");await saved();
const uploads=await page.evaluate(()=>window.__uploads);
assert(uploads.length>=1&&uploads.every(n=>n===0),"mover no debe reenviar audio: "+uploads);
console.log("PASS navegador: mover un segmento guarda solo el manifiesto");
await browser.close();
