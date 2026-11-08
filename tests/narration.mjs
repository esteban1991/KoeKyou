// Narración: alargar pausas, música de fondo con ducking y fundidos, y capa Narración reflexiva.
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mixTracks,RATE} from "../src/audio.js";

// Buffer mínimo compatible con AudioBuffer para probar la mezcla en Node.
const buffer=(channels,length)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate:RATE,duration:length/RATE,getChannelData:c=>data[c]};};
const context={createBuffer:(channels,length)=>buffer(channels,length)};
const rms=(data,from,to)=>{let s=0;for(let i=from*RATE;i<to*RATE;i++)s+=data[i]*data[i];return 20*Math.log10(Math.sqrt(s/((to-from)*RATE)));};
// Voz de 2 a 5 s; música constante de 0 a 8 s.
const voice=buffer(1,8*RATE),music=buffer(1,8*RATE);
for(let i=2*RATE;i<5*RATE;i++)voice.getChannelData(0)[i]=.3*Math.sin(i/9);
for(let i=0;i<8*RATE;i++)music.getChannelData(0)[i]=.1*Math.sin(i/31);
const base={offset:0,gain:0,muted:false};
const plain=mixTracks(context,[{...base,buffer:music}]).getChannelData(0);
const ducked=mixTracks(context,[{...base,buffer:voice},{...base,buffer:music,duck:-12,fadeIn:1,fadeOut:1}]).getChannelData(0);
const onlyMusic=(from,to)=>rms(ducked,from,to)-rms(plain,from,to);
assert(Math.abs(onlyMusic(1.2,1.9))<.5,"antes de la voz la música suena entera");
// Durante la voz, la música (mezcla menos voz) baja ~12 dB.
const voiceOnly=mixTracks(context,[{...base,buffer:voice}]).getChannelData(0);
const residual=ducked.map((v,i)=>v-voiceOnly[i]);
const drop=rms(residual,3,4.8)-rms(plain,3,4.8);
assert(drop<-10&&drop>-13,"ducking de -12 dB durante la voz: "+drop.toFixed(1));
assert(rms(residual,6.5,6.9)-rms(plain,6.5,6.9)>-1.5,"en la pausa vuelve a subir");
assert(rms(residual,0,.2)<rms(plain,0,.2)-12,"fundido de entrada");
assert(rms(residual,7.85,8)<rms(plain,7.85,8)-15,"fundido de salida");
console.log("PASS mezcla: ducking -12 dB con la voz, recuperación en la pausa y fundidos de entrada/salida");

// API: Alargar pausas y la capa nueva.
const wav=(seconds,fill)=>{const n=Math.round(seconds*48000),b=Buffer.alloc(44+n*2);b.write("RIFF",0);b.writeUInt32LE(36+n*2,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(fill(i/48000)*32767),44+i*2);return b;};
// Tres "frases" de 1 s separadas por pausas de 0,5 s con ruido de sala suave.
const speech=wav(5,t=>{const phrase=t%1.5<1&&t<4;return phrase?.4*Math.sin(2*Math.PI*180*t)*(1+.3*Math.sin(2*Math.PI*4*t)):.001*(Math.random()*2-1);});
const form=new FormData();form.append("file",new Blob([speech]),"voz.wav");form.append("amount","100");form.append("minimum","1.2");
const response=await fetch("http://127.0.0.1:8000/pauses",{method:"POST",body:form});
assert.equal(response.status,200);
const stretched=(Number((await response.arrayBuffer()).byteLength)-44)/3/48000;
assert(stretched>5+2*.6&&stretched<5+2*.8,"dos pausas de 0,5 s pasan a 1,2 s: "+stretched.toFixed(2));
const processForm=new FormData();processForm.append("file",new Blob([speech]),"voz.wav");processForm.append("preset","narrator");
assert.equal((await fetch("http://127.0.0.1:8000/process",{method:"POST",body:processForm})).status,200);
console.log("PASS API: pausas de 0,5 s a 1,2 s sin tocar las frases y capa Narración reflexiva");

// Navegador: botones, controles del segmento y persistencia.
const browser=await chromium.launch({channel:"chrome"}),page=await browser.newPage();
await page.goto("http://localhost:5173");
const saved=()=>page.waitForFunction(()=>document.querySelector('[data-testid="save-status"]')?.textContent==="Guardado localmente"&&!document.querySelector('select[aria-label="Abrir proyecto"]')?.disabled);
await saved();
await page.locator(".menu-popover").evaluate(el=>el.closest("details").open=true);
await page.getByRole("button",{name:"Nuevo proyecto"}).click();await saved();
await page.locator('input[type=file][multiple]').setInputFiles({name:"voz.wav",mimeType:"audio/wav",buffer:speech});
await page.waitForFunction(()=>document.querySelectorAll(".audio-track").length===1);await saved();
await page.locator(".edit-actions summary").click();
await page.getByRole("combobox",{name:"Cuánto alargar las pausas"}).selectOption("100");
await page.getByRole("combobox",{name:"Pausa mínima entre frases"}).selectOption("1.5");
await page.getByRole("button",{name:"Alargar pausas"}).click();
await page.waitForFunction(()=>{const total=document.querySelector('[data-testid="playback-time"]')?.textContent.split(" / ")[1]||"";return total.startsWith("0:06")||total.startsWith("0:07");},{},{timeout:60000});
await saved();
await page.getByRole("combobox",{name:"Bajar con la voz"}).selectOption("-12");
await page.getByLabel("Fundido de entrada (s)").fill("2");await page.getByLabel("Fundido de salida (s)").fill("3");await saved();
await page.getByRole("button",{name:"Mejorar voz"}).click();
await page.getByRole("button",{name:"Narración reflexiva",exact:true}).click();
await page.getByRole("button",{name:"Activar capa",exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[data-testid="fx-status"]')?.textContent==="Capas activas en este segmento",{},{timeout:60000});
await saved();
const state=await page.evaluate(async()=>(await fetch("http://127.0.0.1:8000/projects/"+localStorage.getItem("voicemaster-project"))).json());
const t=state.tracks[0];
assert.equal(t.duck,-12);assert.equal(t.fadeIn,2);assert.equal(t.fadeOut,3);assert.equal(t.effects[0].preset,"narrator");
assert(t.frames/48000>6,"el segmento guardado conserva las pausas largas");
await page.reload();await saved();
assert.equal(await page.getByRole("combobox",{name:"Bajar con la voz"}).inputValue(),"-12");
console.log("PASS navegador: Alargar pausas, Bajar con la voz, fundidos y Narración reflexiva guardados en SQLite");
await browser.close();
