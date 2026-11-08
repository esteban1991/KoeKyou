import {useEffect,useRef,useState} from "react";
import {mixTracks} from "../audio";
// Reproducción de la mezcla, de una pista o de un segmento, con loop y cursor en tiempo real.
export function useAudioPlayback({engine,latestTracks,selected,onError}){
 const [playing,setPlaying]=useState(false),[playTime,setPlayTime]=useState(0),[loopEnabled,setLoopEnabled]=useState(false),[playScope,setPlayScope]=useState("all"),[loopCycle,setLoopCycle]=useState(0);
 const frame=useRef(null),sources=useRef([]),outputAnalyser=useRef(null),sliderScrub=useRef(null);
 const session=useRef({generation:0,pending:false});
 const position=useRef({playing:false,time:0});position.current={playing,time:playTime};
 const options=useRef({loop:false,scope:"all",selected:null});options.current={loop:loopEnabled,scope:playScope,selected};
 const report=useRef(onError);report.current=onError;
 const fail=e=>report.current(e.message);
 // Suena o está a punto de sonar (el contexto aún se está reanudando).
 const isActive=()=>position.current.playing||session.current.pending;
 function stop(){session.current.generation++;session.current.pending=false;position.current.playing=false;cancelAnimationFrame(frame.current);for(const source of sources.current){source.onended=null;try{source.stop();source.disconnect();}catch{}}sources.current=[];setPlaying(false);}
 async function playTracks(items,requested=0,opts=options.current){
  stop();
  const generation=session.current.generation;
  session.current.pending=true;
  try{
   let relevant=items,origin=0;
   if(opts.scope!=="all"){
    const chosen=items.find(t=>t.id===opts.selected);
    if(!chosen)throw new Error("Selecciona el segmento que quieres repetir.");
    relevant=opts.scope==="clip"?[chosen]:items.filter(t=>(t.laneId||"primary")===(chosen.laneId||"primary"));
    relevant=relevant.filter(t=>!t.muted);
    if(!relevant.length)throw new Error("El audio seleccionado está silenciado.");
    origin=Math.min(...relevant.map(t=>t.offset));
    relevant=relevant.map(t=>({...t,offset:t.offset-origin}));
   }
   const ctx=await engine.audioContext();
   if(generation!==session.current.generation||!engine.mounted.current)return;
   const buffer=mixTracks(ctx,relevant),source=ctx.createBufferSource();
   const local=requested-origin,start=local<0||local>=buffer.duration?0:local,startedAt=ctx.currentTime;
   source.buffer=buffer;source.loop=opts.loop;source.loopStart=0;source.loopEnd=buffer.duration;
   if(!outputAnalyser.current||outputAnalyser.current.context!==ctx){
    const analyser=ctx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.72;analyser.minDecibels=-90;analyser.maxDecibels=-12;
    analyser.connect(ctx.destination);outputAnalyser.current=analyser;
   }
   source.connect(outputAnalyser.current);
   source.onended=()=>{
    if(generation!==session.current.generation)return;
    cancelAnimationFrame(frame.current);sources.current=[];source.disconnect();
    position.current.playing=false;
    if(engine.mounted.current){setPlaying(false);setPlayTime(origin+buffer.duration);}
   };
   sources.current=[source];source.start(0,start);session.current.pending=false;
   position.current.playing=true;setPlaying(true);setPlayTime(origin+start);setLoopCycle(0);
   const tick=()=>{
    if(!engine.mounted.current||generation!==session.current.generation)return;
    const elapsed=start+ctx.currentTime-startedAt;
    const relative=source.loop?elapsed%buffer.duration:Math.min(buffer.duration,elapsed);
    setPlayTime(origin+relative);setLoopCycle(source.loop?Math.floor(elapsed/buffer.duration):0);
    frame.current=requestAnimationFrame(tick);
   };
   frame.current=requestAnimationFrame(tick);
  }catch(e){if(generation===session.current.generation)stop();throw e;}
 }
 const resumeAt=time=>playTracks(latestTracks.current,time).catch(fail);
 // Cambia el audio que suena sin cortar la escucha: se detiene y continúa en el mismo punto.
 function swapAudio(next,apply){const {playing:was,time}=position.current;if(was)stop();apply(next);if(was)return playTracks(next,time).catch(fail);}
 function changeOptions(patch){
  const next={...options.current,...patch};
  options.current=next;setLoopEnabled(next.loop);setPlayScope(next.scope);
  if(isActive()){const time=position.current.time;stop();playTracks(latestTracks.current,time,next).catch(fail);}
 }
 function loopClip(track){
  const next={loop:true,scope:"clip",selected:track.id};
  options.current=next;setLoopEnabled(true);setPlayScope("clip");
  playTracks(latestTracks.current,track.offset,next).catch(fail);
 }
 async function toggle(){if(isActive()){stop();return;}try{await playTracks(latestTracks.current,position.current.time);}catch(e){fail(e);}}
 // Barra de reproducción: si sonaba, sigue sonando desde el punto elegido sin pulsar reproducir.
 const release=e=>{const s=sliderScrub.current;sliderScrub.current=null;if(s?.wasPlaying)resumeAt(Number(e.currentTarget.value));};
 const slider={
  onPointerDown:()=>{sliderScrub.current={wasPlaying:isActive()};stop();},
  onChange:e=>{
   const time=Number(e.target.value);setPlayTime(time);
   if(sliderScrub.current)return;
   // Teclado: cada paso salta de inmediato.
   const was=isActive();stop();if(was)resumeAt(time);
  },
  onPointerUp:release,onPointerCancel:release
 };
 // Con loop de segmento o pista, cambiar la selección cambia lo que suena.
 const previousSelection=useRef(selected);
 useEffect(()=>{
  const changed=previousSelection.current!==selected;previousSelection.current=selected;
  if(!changed||options.current.scope==="all"||!isActive())return;
  const time=position.current.time;stop();
  if(selected)playTracks(latestTracks.current,time).catch(fail);
 },[selected]);
 useEffect(()=>()=>{cancelAnimationFrame(frame.current);for(const s of sources.current){try{s.stop();}catch{}}},[]);
 return {playing,playTime,setPlayTime,loopEnabled,playScope,loopCycle,outputAnalyser,isActive,stop,playTracks,resumeAt,swapAudio,changeOptions,loopClip,toggle,slider};
}
