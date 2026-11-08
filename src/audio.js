export const RATE=48000;
export function wav(buffer){
 const channels=buffer.numberOfChannels,frames=buffer.length;
 const bytes=new ArrayBuffer(44+frames*channels*3),view=new DataView(bytes);
 const text=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
 text(0,"RIFF");view.setUint32(4,bytes.byteLength-8,true);text(8,"WAVE");text(12,"fmt ");
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);
 view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*3,true);
 view.setUint16(32,channels*3,true);view.setUint16(34,24,true);text(36,"data");view.setUint32(40,frames*channels*3,true);
 const data=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));
 let offset=44;
 for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){
  const sample=Math.max(-1,Math.min(1,data[c][i]));
  const value=Math.round(sample*(sample<0?8388608:8388607));
  view.setUint8(offset++,value&255);view.setUint8(offset++,(value>>8)&255);view.setUint8(offset++,(value>>16)&255);
 }
 return new Blob([bytes],{type:"audio/wav"});
}
export function sliceAudio(context,buffer,start,end){
 const a=Math.max(0,Math.round(start*buffer.sampleRate)),b=Math.min(buffer.length,Math.round(end*buffer.sampleRate));
 if(b<=a)throw new Error("Selecciona al menos una muestra de audio.");
 const result=context.createBuffer(buffer.numberOfChannels,b-a,buffer.sampleRate);
 for(let c=0;c<buffer.numberOfChannels;c++)result.copyToChannel(buffer.getChannelData(c).subarray(a,b),c);
 return result;
}
export function deleteAudio(context,buffer,start,end){
 const a=Math.max(0,Math.round(start*buffer.sampleRate)),b=Math.min(buffer.length,Math.round(end*buffer.sampleRate));
 if(b<=a||b-a>=buffer.length)throw new Error("La selección debe dejar audio en la pista.");
 const result=context.createBuffer(buffer.numberOfChannels,buffer.length-(b-a),buffer.sampleRate);
 for(let c=0;c<buffer.numberOfChannels;c++){
  const original=buffer.getChannelData(c),target=result.getChannelData(c);
  target.set(original.subarray(0,a));target.set(original.subarray(b),a);
 }
 return result;
}
const FRAME=480; // 10 ms a 48 kHz
// Curva de ducking (0..1 por bloque de 10 ms): 1 en silencio, `depth` mientras suena la voz.
// Baja en ~60 ms, espera 300 ms por si sigue la frase y sube en ~700 ms: la música respira en las pausas.
function duckCurve(voices,frames,depth){
 const energy=new Float32Array(frames);
 for(const t of voices){
  const offset=Math.round(t.offset*RATE),gain=10**(t.gain/20),source=t.buffer.getChannelData(0);
  for(let i=0;i<source.length;i++){const f=((i+offset)/FRAME)|0;if(f>=frames)break;const v=source[i]*gain;energy[f]+=v*v;}
 }
 const curve=new Float32Array(frames),down=1-Math.exp(-10/60),up=1-Math.exp(-10/700);
 let level=1,hold=0;
 for(let f=0;f<frames;f++){
  if(10*Math.log10(energy[f]/FRAME+1e-12)>-45)hold=30;else if(hold>0)hold--;
  const target=hold>0?depth:1;level+=(target-level)*(target<level?down:up);curve[f]=level;
 }
 return curve;
}
// Segmentos marcados con `duck` (música de fondo) bajan cuando suenan los demás; `fadeIn`/`fadeOut` en segundos.
export function mixTracks(context,tracks){
 const active=tracks.filter(t=>!t.muted);
 if(!active.length)throw new Error("Activa al menos un segmento.");
 const duration=Math.max(...active.map(t=>t.offset+t.buffer.duration));
 if(duration>900)throw new Error("La mezcla puede durar como máximo 15 minutos.");
 const result=context.createBuffer(2,Math.max(1,Math.ceil(duration*RATE)),RATE);
 const frames=Math.ceil(result.length/FRAME)+1,voices=active.filter(t=>!t.duck),curves=new Map();
 for(const track of active){
  if(track.buffer.sampleRate!==RATE)throw new Error("El segmento debe estar a 48 kHz.");
  const offset=Math.round(track.offset*RATE),gain=10**(track.gain/20),length=track.buffer.length;
  const fadeIn=Math.round((track.fadeIn||0)*RATE),fadeOut=Math.round((track.fadeOut||0)*RATE);
  let duck=null;
  if(track.duck&&voices.length){if(!curves.has(track.duck))curves.set(track.duck,duckCurve(voices,frames,10**(track.duck/20)));duck=curves.get(track.duck);}
  for(let c=0;c<2;c++){
   const source=track.buffer.getChannelData(Math.min(c,track.buffer.numberOfChannels-1)),target=result.getChannelData(c);
   for(let i=0;i<length&&i+offset<target.length;i++){
    let g=gain;
    if(i<fadeIn)g*=i/fadeIn;
    if(length-i<fadeOut)g*=(length-i)/fadeOut;
    if(duck){const p=(i+offset)/FRAME,f=p|0;g*=duck[f]+(duck[f+1]-duck[f])*(p-f);}
    target[i+offset]+=source[i]*g;
   }
  }
 }
 let peak=0;
 for(let c=0;c<2;c++)for(const value of result.getChannelData(c))peak=Math.max(peak,Math.abs(value));
 // Atenuación global, solo si la suma supera -1 dBFS; evita recorte digital.
 const scale=peak>10**(-1/20)?10**(-1/20)/peak:1;
 if(scale<1)for(let c=0;c<2;c++){const data=result.getChannelData(c);for(let i=0;i<data.length;i++)data[i]*=scale;}
 return result;
}
export function download(buffer,name){
 const url=URL.createObjectURL(wav(buffer)),a=document.createElement("a");
 a.href=url;a.download=name.endsWith(".wav")?name:name+".wav";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
