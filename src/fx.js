import {wav} from "./audio";
const API="http://127.0.0.1:8000";
export const masterDefaults={mic:"generic",loudness:"-16",ai_denoise:0};
// Firma de lo que suena en una pista: capas activas más ajustes maestros.
export const fxSignature=(layers,master)=>JSON.stringify({layers:(layers||[]).filter(layer=>layer.enabled!==false),master});
const metric=(response,name)=>{const value=response.headers.get(name);return value?Number(value):null;};
export async function processLayers(buffer,layers,master,signal,onProgress=()=>{}){
 let blob=wav(buffer),stats=null;
 const enabled=layers.filter(layer=>layer.enabled!==false);
 for(const [index,layer] of enabled.entries()){
  onProgress("Procesando "+layer.name+" · "+(index+1)+"/"+enabled.length);
  const data=new FormData();data.append("file",blob,"voz.wav");data.append("preset",layer.preset);
  Object.entries(layer.settings).forEach(([key,value])=>data.append(key,value));
  // La IA y la corrección del micrófono actúan sobre la toma original (primera capa);
  // la sonoridad se fija una sola vez, al final de la cadena.
  data.set("mic",index===0?master.mic:"generic");
  data.set("ai_denoise",index===0?master.ai_denoise:0);
  data.set("loudness",index===enabled.length-1?master.loudness:"off");
  for(let attempt=0;;attempt++){
   signal.throwIfAborted();
   const response=await fetch(API+"/process",{method:"POST",body:data,signal});
   if(response.status===429&&attempt<100){onProgress("Esperando al motor ocupado…");await new Promise(resolve=>setTimeout(resolve,Math.min(2000,250+attempt*150)));continue;}
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(typeof body.detail==="string"?body.detail:"No se pudieron actualizar los efectos.");}
   if(index===enabled.length-1)stats={input:metric(response,"X-Input-LUFS"),output:metric(response,"X-Output-LUFS"),peak:metric(response,"X-True-Peak")};
   blob=await response.blob();break;
  }
 }
 return {blob,stats};
}
// Alarga los silencios entre frases; la voz no cambia. Devuelve el segmento completo, más largo.
export async function stretchPauses(buffer,amount,minimum){
 const form=new FormData();form.append("file",wav(buffer),"voz.wav");form.append("amount",amount);form.append("minimum",minimum);
 const response=await fetch(API+"/pauses",{method:"POST",body:form});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(typeof body.detail==="string"?body.detail:"No se pudieron alargar las pausas.");}
 return response.blob();
}
export async function changeTempo(buffer,speed){
 const form=new FormData();form.append("file",wav(buffer),"voz.wav");form.append("speed",speed);
 const response=await fetch(API+"/tempo",{method:"POST",body:form});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(typeof body.detail==="string"?body.detail:"No se pudo cambiar la velocidad.");}
 return response.blob();
}
