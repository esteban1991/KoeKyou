import {useState} from "react";
import {sliceAudio,deleteAudio,mixTracks} from "../audio";
import {changeTempo} from "../fx";
export const MAX_SEGMENTS=16;
const checkFile=file=>{if(!/\.(wav|mp3)$/i.test(file.name)||file.size>100*1024*1024)throw new Error("Usa WAV o MP3 de hasta 100 MB.");};
const checkBuffer=buffer=>{if(buffer.duration>900||buffer.numberOfChannels>2)throw new Error("Cada archivo debe ser mono o estéreo y durar hasta 15 minutos.");};
// Operaciones sobre los segmentos del proyecto: añadir, cortar, mover, combinar y deshacer.
export function useAudioEditing({engine,tracks,setTracks,latestTracks,selected,setSelected,playback,setError,setWorking,setReveal,fxPending}){
 const [selection,setSelection]=useState([0,0]),[history,setHistory]=useState([]),[tempo,setTempo]=useState(1);
 const [placement,setPlacement]=useState("end"),[destination,setDestination]=useState("current");
 const track=tracks.find(t=>t.id===selected);
 const currentLane=track?.laneId||tracks[0]?.laneId||"primary";
 const laneEnd=Math.max(0,...tracks.filter(t=>(t.laneId||"primary")===currentLane).map(t=>t.offset+t.buffer.duration));
 // Dónde empieza el próximo segmento grabado o importado.
 const insertionPoint=placement==="end"?(destination==="new"?0:laneEnd):placement==="cursor"?playback.playTime:0;
 const targetLane=()=>destination==="new"?crypto.randomUUID():currentLane;
 const remember=previous=>setHistory(h=>[...h.slice(-9),previous]);
 function change(next){playback.stop();playback.setPlayTime(0);remember(latestTracks.current);setTracks(next);}
 function choose(t){setSelected(t.id);setSelection([0,t.buffer.duration]);}
 // Tras añadir audio: se selecciona, se muestra y el destino vuelve a la pista actual.
 function placed(t){choose(t);setDestination("current");setReveal(t.offset);setPlacement(p=>p==="cursor"?"end":p);}
 function addBuffers(items){
  let offset=insertionPoint;const laneId=targetLane();
  const additions=items.map(item=>{const t={...item,id:crypto.randomUUID(),gain:0,offset,laneId,muted:false,effects:[]};if(placement!=="overlap")offset+=item.buffer.duration;return t;});
  change([...tracks,...additions]);placed(additions.at(-1));setReveal(additions[0].offset);
 }
 async function importFiles(list){
  setWorking(true);setError("");
  try{
   if(tracks.length+list.length>MAX_SEGMENTS)throw new Error("El máximo es "+MAX_SEGMENTS+" segmentos.");
   const ctx=await engine.audioContext(),items=[];
   for(const file of list){checkFile(file);const buffer=await ctx.decodeAudioData(await file.arrayBuffer());checkBuffer(buffer);items.push({name:file.name.replace(/\.[^.]+$/,""),buffer});}
   if(items.length)addBuffers(items);
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 function commitRecording(take,original){
  playback.stop();playback.setPlayTime(0);
  remember(original);setTracks([...original,take]);placed(take);
 }
 function undo(){
  playback.stop();playback.setPlayTime(0);const previous=history.at(-1);
  setTracks(previous);setHistory(h=>h.slice(0,-1));if(previous.length)choose(previous[0]);else setSelected(null);
 }
 // Al cambiar el audio base, las capas de efecto se vuelven a calcular sobre él.
 const rebased=(t,buffer)=>({...t,buffer,originalBuffer:(t.effects||[]).length?buffer:null,renderedEffects:"",processed:false});
 function edit(action){
  if(!track)return;setError("");
  try{
   const ctx=engine.editingContext(),[a,b]=selection,source=track.originalBuffer||track.buffer,duration=source.duration;
   if(action==="split"){
    if(tracks.length>=MAX_SEGMENTS)throw new Error("El máximo es "+MAX_SEGMENTS+" segmentos.");
    if(a<=0||a>=duration)throw new Error("Coloca Inicio dentro del segmento para dividirlo.");
    const left=rebased(track,sliceAudio(ctx,source,0,a));
    const right={...rebased(track,sliceAudio(ctx,source,a,duration)),id:crypto.randomUUID(),name:track.name+" · corte",offset:track.offset+a};
    change(tracks.flatMap(t=>t.id===track.id?[left,right]:[t]));choose(right);
   }else if(action==="extract"){
    if(a<=0||b>=duration||b<=a)throw new Error("Selecciona un tramo interior para extraerlo.");
    if(tracks.length>MAX_SEGMENTS-2)throw new Error("Necesitas espacio para dos segmentos más.");
    const parts=[[0,a],[a,b],[b,duration]].map(([start,end],i)=>({...rebased(track,sliceAudio(ctx,source,start,end)),id:i===0?track.id:crypto.randomUUID(),name:track.name+" · "+(i+1),offset:track.offset+start}));
    change(tracks.flatMap(t=>t.id===track.id?parts:[t]));choose(parts[1]);
   }else{
    const buffer=action==="trim"?sliceAudio(ctx,source,a,b):deleteAudio(ctx,source,a,b);
    change(tracks.map(t=>t.id===track.id?{...rebased(t,buffer),offset:action==="trim"?t.offset+a:t.offset}:t));setSelection([0,buffer.duration]);
   }
  }catch(e){setError(e.message);}
 }
 function patch(id,values){change(tracks.map(t=>t.id===id?{...t,...values}:t));}
 function moveTo(id,offset){change(latestTracks.current.map(t=>t.id===id?{...t,offset}:t));}
 function remove(id){change(latestTracks.current.filter(t=>t.id!==id));if(selected===id)setSelected(null);}
 async function applyTempo(){
  if(!track)return;setWorking(true);setError("");playback.stop();
  try{
   const blob=await changeTempo(track.originalBuffer||track.buffer,tempo);
   const buffer=await engine.editingContext().decodeAudioData(await blob.arrayBuffer());
   change(latestTracks.current.map(t=>t.id===track.id?rebased(t,buffer):t));
   setSelection([0,buffer.duration]);setTempo(1);
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 async function replaceOriginal(file){
  if(!file||!track)return;setWorking(true);setError("");
  try{
   checkFile(file);
   const ctx=await engine.audioContext(),buffer=await ctx.decodeAudioData(await file.arrayBuffer());checkBuffer(buffer);
   change(latestTracks.current.map(t=>t.id===track.id?{...t,buffer,originalBuffer:null,effects:[],renderedEffects:"",processed:false,sourceDescription:"Archivo original restaurado"}:t));
   setSelection([0,buffer.duration]);
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 function combine(){
  setError("");
  try{
   if(fxPending)throw new Error("Espera a que terminen los efectos.");
   const active=tracks.filter(t=>!t.muted);
   if(active.length<2)throw new Error("Activa al menos dos segmentos para combinarlos.");
   const buffer=mixTracks(engine.editingContext(),active);
   const combined={id:crypto.randomUUID(),name:"Segmentos combinados",laneId:currentLane,offset:0,gain:0,muted:false,buffer,effects:[],processed:false,sourceDescription:"Mezcla: efectos incorporados al audio"};
   change([...tracks.filter(t=>t.muted),combined]);choose(combined);
  }catch(e){setError(e.message);}
 }
 return {track,selection,setSelection,history,setHistory,remember,tempo,setTempo,placement,setPlacement,destination,setDestination,currentLane,insertionPoint,targetLane,change,choose,addBuffers,importFiles,commitRecording,undo,edit,patch,moveTo,remove,applyTempo,replaceOriginal,combine};
}
