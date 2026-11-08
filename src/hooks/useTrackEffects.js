import {useEffect,useRef,useState} from "react";
import {processLayers,fxSignature} from "../fx";
const ACTIVE="Capas activas en este segmento",ORIGINAL="Audio original · sin efectos";
export const hasActiveLayers=t=>(t.effects||[]).some(l=>l.enabled!==false);
// Hay segmentos cuyo audio aún no refleja sus capas o los ajustes maestros.
export const effectsPending=(tracks,settings)=>tracks.some(t=>hasActiveLayers(t)&&t.renderedEffects!==fxSignature(t.effects,settings));
// Mantiene cada segmento sincronizado con sus capas de efecto: el motor procesa en cola y
// el audio procesado sustituye al original sin cortar la reproducción.
export function useTrackEffects({engine,tracks,setTracks,latestTracks,settings,selected,playback,remember}){
 const [fxStates,setFxStates]=useState({});
 const jobs=useRef(new Map()),queue=useRef(Promise.resolve()),latestMaster=useRef(settings);latestMaster.current=settings;
 function updateEffects(effects){
  const t=latestTracks.current.find(item=>item.id===selected);
  if(!t)return;
  remember(latestTracks.current);
  const audible=JSON.stringify((t.effects||[]).filter(l=>l.enabled!==false))!==JSON.stringify(effects.filter(l=>l.enabled!==false));
  const next=latestTracks.current.map(item=>item.id===t.id?{...item,effects,originalBuffer:item.originalBuffer||item.buffer,...(audible?{buffer:item.originalBuffer||item.buffer,renderedEffects:"",processed:false}:{})}:item);
  if(audible)playback.swapAudio(next,setTracks);else setTracks(next);
 }
 function retry(){jobs.current.get(selected)?.controller.abort();jobs.current.delete(selected);setTracks(current=>[...current]);}
 useEffect(()=>{
  for(const [id,job] of jobs.current)if(!tracks.some(t=>t.id===id)){job.controller.abort();clearTimeout(job.timer);jobs.current.delete(id);}
  const status=(id,value)=>setFxStates(old=>{const stats=value.stats===undefined?old[id]?.stats:value.stats;return old[id]?.status===value.status&&old[id]?.error===value.error&&old[id]?.stats===stats?old:{...old,[id]:{...value,stats}};});
  for(const t of tracks){
   const layers=t.effects||[],signature=fxSignature(layers,settings),previous=jobs.current.get(t.id);
   if(!hasActiveLayers(t)){
    previous?.controller.abort();clearTimeout(previous?.timer);jobs.current.delete(t.id);
    if(t.originalBuffer)playback.swapAudio(latestTracks.current.map(item=>item.id===t.id?{...item,buffer:item.originalBuffer,originalBuffer:null,processed:false,renderedEffects:""}:item),setTracks);
    status(t.id,{status:ORIGINAL,stats:null});continue;
   }
   if(t.renderedEffects===signature){status(t.id,{status:ACTIVE});continue;}
   const source=t.originalBuffer||t.buffer;
   if(previous?.signature===signature&&previous.source===source)continue;
   previous?.controller.abort();clearTimeout(previous?.timer);
   const controller=new AbortController(),job={controller,source,signature,timer:null};jobs.current.set(t.id,job);
   status(t.id,{status:"Actualizando efectos…"});
   job.timer=setTimeout(()=>{
    const run=async()=>{
     if(controller.signal.aborted||!engine.mounted.current)return;
     try{
      if(source.length*source.numberOfChannels*3>100*1024*1024)throw new Error("Recorta el segmento a menos de 100 MB para usar los efectos.");
      const {blob,stats}=await processLayers(source,layers,settings,controller.signal,message=>{if(!controller.signal.aborted&&engine.mounted.current)status(t.id,{status:message});});
      controller.signal.throwIfAborted();
      const buffer=await engine.editingContext().decodeAudioData(await blob.arrayBuffer());
      if(controller.signal.aborted||!engine.mounted.current)return;
      const current=latestTracks.current.find(item=>item.id===t.id);
      if(!current||fxSignature(current.effects,latestMaster.current)!==signature||(current.originalBuffer||current.buffer)!==source)return;
      status(t.id,{status:ACTIVE,stats});
      await playback.swapAudio(latestTracks.current.map(item=>item.id===t.id?{...item,buffer,originalBuffer:source,renderedEffects:signature,processed:true}:item),setTracks);
     }catch(e){if(e.name!=="AbortError"&&!controller.signal.aborted&&engine.mounted.current)status(t.id,{status:"No se pudieron actualizar los efectos",error:e.message});}
    };
    queue.current=queue.current.catch(()=>{}).then(run);
   },450);
  }
 },[tracks,settings]);
 useEffect(()=>()=>{for(const job of jobs.current.values()){job.controller.abort();clearTimeout(job.timer);}},[]);
 // Texto de estado de un segmento para el panel de capas.
 const describe=t=>fxStates[t.id]?.status||(t.processed?"Capas guardadas":ORIGINAL);
 return {fxStates,updateEffects,retry,describe};
}
