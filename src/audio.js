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
export function mixTracks(context,tracks){
 const active=tracks.filter(t=>!t.muted);
 if(!active.length)throw new Error("Activa al menos una pista.");
 const duration=Math.max(...active.map(t=>t.offset+t.buffer.duration));
 if(duration>900)throw new Error("La mezcla puede durar como máximo 15 minutos.");
 const result=context.createBuffer(2,Math.max(1,Math.ceil(duration*RATE)),RATE);
 for(const track of active){
  if(track.buffer.sampleRate!==RATE)throw new Error("La pista debe estar a 48 kHz.");
  const offset=Math.round(track.offset*RATE),gain=10**(track.gain/20);
  for(let c=0;c<2;c++){
   const source=track.buffer.getChannelData(Math.min(c,track.buffer.numberOfChannels-1)),target=result.getChannelData(c);
   for(let i=0;i<source.length&&i+offset<target.length;i++)target[i+offset]+=source[i]*gain;
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
