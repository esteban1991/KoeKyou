import NeonSpectrum from "./NeonSpectrum";
import {processLayers,changeTempo,fxSignature,masterDefaults} from "./fx";
import {createLoudnessMeter} from "./loudness";
import LiveRecording from "./LiveRecording";
import {useProjectStore} from "./projectStore";
import {useEffect,useRef,useState,useImperativeHandle} from "react";
import {Mic,Square,Plus,Scissors,Trash2,Undo2,Play,Download,Volume2,VolumeX,ChevronDown,Save,Copy,FolderOpen,SlidersHorizontal,X,GripHorizontal,AudioLines} from "lucide-react";
import {RATE,wav,sliceAudio,deleteAudio,mixTracks,download} from "./audio";

const clock=s=>{const n=Math.max(0,s);return Math.floor(n/60)+":"+(n%60).toFixed(2).padStart(5,"0");};
// Los segmentos que no se solapan comparten fila: una toma nueva aparece a continuación, no debajo.
function packRows(clips){
 const groups=new Map();
 for(const clip of clips){const lane=clip.laneId||"primary";if(!groups.has(lane))groups.set(lane,[]);groups.get(lane).push(clip);}
 return [...groups.values()];
}
function Waveform({track,selection,onSelect,disabled}){
 const canvas=useRef(null),anchor=useRef(null);
 useEffect(()=>{
  const el=canvas.current,draw=()=>{
   const width=el.clientWidth,height=100,dpr=window.devicePixelRatio||1;
   el.width=width*dpr;el.height=height*dpr;
   const ctx=el.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
   const source=track.buffer.getChannelData(0);
   ctx.strokeStyle=track.muted?"#626572":"#b7a0ed";ctx.lineWidth=1;
   for(let x=0;x<width;x++){
    const a=Math.floor(x*source.length/width),b=Math.max(a+1,Math.floor((x+1)*source.length/width));
    let peak=0;for(let i=a;i<b;i++)peak=Math.max(peak,Math.abs(source[i]||0));
    ctx.beginPath();ctx.moveTo(x,50-peak*46);ctx.lineTo(x,50+Math.max(1,peak*46));ctx.stroke();
   }
   if(selection){ctx.fillStyle="#c9b4ff33";ctx.fillRect(selection[0]/track.buffer.duration*width,0,(selection[1]-selection[0])/track.buffer.duration*width,height);}
  };
  const observer=new ResizeObserver(draw);observer.observe(el);draw();return()=>observer.disconnect();
 },[track.buffer,track.muted,selection]);
 const time=e=>{const box=canvas.current.getBoundingClientRect();return Math.max(0,Math.min(track.buffer.duration,(e.clientX-box.left)/box.width*track.buffer.duration));};
 return <canvas ref={canvas} className="waveform" aria-label="Forma de onda: arrastra para seleccionar; también puedes usar los campos Inicio y Fin" onPointerDown={e=>{if(disabled)return;anchor.current=time(e);e.currentTarget.setPointerCapture(e.pointerId);onSelect([anchor.current,anchor.current]);}} onPointerMove={e=>{if(anchor.current===null||disabled)return;const t=time(e);onSelect([Math.min(anchor.current,t),Math.max(anchor.current,t)]);}} onPointerUp={()=>{anchor.current=null;}} onPointerCancel={()=>{anchor.current=null;}}/>;
}
export default function AudioEditor({editorRef,onTrackSelection,disabled=false,settings=masterDefaults,preset,onRestoreSettings,onShowEffects}){
 const latestMaster=useRef(settings);latestMaster.current=settings;
 const [tracks,setTracks]=useState([]),[selected,setSelected]=useState(null),[selection,setSelection]=useState([0,0]);
 const [history,setHistory]=useState([]),[error,setError]=useState(""),[working,setWorking]=useState(false);
 const [recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0),[playing,setPlaying]=useState(false),[playTime,setPlayTime]=useState(0),[loopEnabled,setLoopEnabled]=useState(false),[playScope,setPlayScope]=useState("all"),[loopCycle,setLoopCycle]=useState(0);
 const context=useRef(null),input=useRef(null),rec=useRef(null),sources=useRef([]),workletReady=useRef(false),mounted=useRef(true);
 const frame=useRef(null),menu=useRef(null),latestTracks=useRef(tracks);latestTracks.current=tracks;
 const [capture,setCapture]=useState({peaks:[],frames:0});
 const [mode,setMode]=useState(null),[placement,setPlacement]=useState("end"),[destination,setDestination]=useState("current"),[zoom,setZoom]=useState(64),[dragPreview,setDragPreview]=useState(null),[tempo,setTempo]=useState(1),[fxStates,setFxStates]=useState({}),[reveal,setReveal]=useState(null);
 const viewport=useRef(null),replacePicker=useRef(null),drag=useRef(null),scrub=useRef(null),fxJobs=useRef(new Map()),fxQueue=useRef(Promise.resolve()),playback=useRef({playing:false,time:0});playback.current={playing,time:playTime};
 const outputAnalyser=useRef(null),micAnalyser=useRef(null);
 const playbackSession=useRef({generation:0,pending:false});
 const playOptions=useRef({loop:false,scope:"all",selected:null});playOptions.current={loop:loopEnabled,scope:playScope,selected};
 const onInvalidate=()=>{};
 const store=useProjectStore({tracks,setTracks,settings,preset,onSettings:onRestoreSettings,onReset:()=>{stopPlayback();setPlayTime(0);setSelected(null);setHistory([]);onInvalidate();}});
 function closeMenu(){if(menu.current)menu.current.open=false;}
 const editingContext=()=>context.current||new OfflineAudioContext(2,1,RATE);
 const duration=Math.max(0,...tracks.map(t=>(dragPreview?.id===t.id?dragPreview.offset:t.offset)+t.buffer.duration));
 const liveTake=recording&&rec.current?{id:rec.current.id,ghost:true,offset:rec.current.offset,laneId:rec.current.laneId,duration:Math.max(.2,capture.frames/(context.current?.sampleRate||RATE))}:null;
 const rows=packRows([...tracks.filter(t=>t.id!==liveTake?.id).map(t=>({id:t.id,laneId:t.laneId||"primary",track:t,offset:t.offset,duration:t.buffer.duration})),...(liveTake?[liveTake]:[])]);
 const timelineSpan=Math.max(10,Math.ceil((Math.max(duration,liveTake?liveTake.offset+liveTake.duration:0)+2)/5)*5);
 const pct=seconds=>(seconds/timelineSpan*100)+"%";
 const timelineWidth=Math.min(30000,Math.max(800,timelineSpan*zoom));
 const currentLane=tracks.find(t=>t.id===selected)?.laneId||tracks[0]?.laneId||"primary";
 const laneEnd=Math.max(0,...tracks.filter(t=>(t.laneId||"primary")===currentLane).map(t=>t.offset+t.buffer.duration));
 const insertionPoint=placement==="end"?(destination==="new"?0:laneEnd):placement==="cursor"?playTime:0;
 const fxPending=tracks.some(t=>(t.effects||[]).some(l=>l.enabled!==false)&&t.renderedEffects!==fxSignature(t.effects,settings));
 const locked=disabled||working||recording||!store.ready||store.switching;
 async function audioContext(){if(!context.current)context.current=new AudioContext({sampleRate:RATE});await context.current.resume();return context.current;}
 function stopPlayback(){playbackSession.current.generation++;playbackSession.current.pending=false;playback.current.playing=false;cancelAnimationFrame(frame.current);for(const source of sources.current){source.onended=null;try{source.stop();source.disconnect();}catch{}}sources.current=[];setPlaying(false);}
 function change(next){onInvalidate();stopPlayback();setPlayTime(0);setHistory(h=>[...h.slice(-9),latestTracks.current]);setTracks(next);}
 function choose(track){setSelected(track.id);setSelection([0,track.buffer.duration]);}
 function addBuffers(items){
 let offset=insertionPoint;const laneId=destination==="new"?crypto.randomUUID():currentLane;
 const additions=items.map(item=>{const t={...item,id:crypto.randomUUID(),gain:0,offset,laneId,muted:false,effects:[]};if(placement!=="overlap")offset+=item.buffer.duration;return t;});
 change([...tracks,...additions]);choose(additions.at(-1));setDestination("current");
 setReveal(additions[0].offset);if(placement==="cursor")setPlacement("end");
}
 // Coloca el cursor donde se hace clic y permite arrastrarlo; la próxima toma o importación empieza ahí.
 const timeAt=e=>{const box=(viewport.current.querySelector(".timeline-lane")||e.currentTarget).getBoundingClientRect();return Math.round(Math.max(0,Math.min(900,(e.clientX-box.left)/box.width*timelineSpan))*100)/100;};
 function seek(e){
  if(locked)return;
  e.preventDefault();e.stopPropagation();
  scrub.current={wasPlaying:playback.current.playing};stopPlayback();
  e.currentTarget.setPointerCapture(e.pointerId);
  setPlayTime(timeAt(e));setPlacement("cursor");
 }
 function scrubMove(e){
  if(!scrub.current)return;
  const box=viewport.current.getBoundingClientRect();
  if(e.clientX>box.right-35)viewport.current.scrollLeft+=18;
  if(e.clientX<box.left+35)viewport.current.scrollLeft-=18;
  setPlayTime(timeAt(e));
 }
 function scrubEnd(e){
  const s=scrub.current;if(!s)return;scrub.current=null;
  // Si sonaba, sigue desde el nuevo punto al soltar.
  if(s.wasPlaying)playTracks(latestTracks.current,timeAt(e)).catch(err=>setError(err.message));
 }
 const scrubbing={onPointerMove:scrubMove,onPointerUp:scrubEnd,onPointerCancel:scrubEnd};
 useEffect(()=>{
  const v=viewport.current;if(reveal===null||!v)return;
  const x=reveal/timelineSpan*v.scrollWidth;
  if(x<v.scrollLeft+40||x>v.scrollLeft+v.clientWidth-80)v.scrollTo({left:Math.max(0,x-80),behavior:"smooth"});
  v.scrollIntoView({block:"nearest",behavior:"smooth"});setReveal(null);
 },[reveal,timelineSpan]);
 useEffect(()=>{
  const v=viewport.current;if(!liveTake||!v)return;
  const x=(liveTake.offset+liveTake.duration)/timelineSpan*v.scrollWidth;
  if(x>v.scrollLeft+v.clientWidth-60)v.scrollLeft=x-v.clientWidth+160;
 },[liveTake?.duration,timelineSpan]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelAnimationFrame(frame.current);for(const s of sources.current){try{s.stop();}catch{}}const r=rec.current;if(r){r.stream.getTracks().forEach(t=>t.stop());r.node.disconnect();r.source.disconnect();}context.current?.close();context.current=null;};},[]);
 useEffect(()=>{if(!recording)return;const timer=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(timer);},[recording]);
 useEffect(()=>{if(seconds>=600&&recording)stopRecording();},[seconds,recording]);
 async function importFiles(list){
  setWorking(true);setError("");
  try{
   if(tracks.length+list.length>16)throw new Error("El máximo es 16 pistas.");
   const ctx=await audioContext(),items=[];
   for(const file of list){
    if(!/\.(wav|mp3)$/i.test(file.name)||file.size>100*1024*1024)throw new Error("Usa WAV o MP3 de hasta 100 MB.");
    const buffer=await ctx.decodeAudioData(await file.arrayBuffer());
    if(buffer.duration>900||buffer.numberOfChannels>2)throw new Error("Cada pista debe ser mono o estéreo y durar hasta 15 minutos.");
    items.push({name:file.name.replace(/\.[^.]+$/,""),buffer});
   }
   if(items.length)addBuffers(items);
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 function capturedBuffer(session){
  const length=session.chunks.reduce((sum,c)=>sum+c.length,0);
  if(!length)return null;
  const buffer=context.current.createBuffer(1,length,context.current.sampleRate);
  let offset=0;for(const chunk of session.chunks){buffer.getChannelData(0).set(chunk,offset);offset+=chunk.length;}
  return buffer;
 }
 function prepareTrack(t){choose(t);onShowEffects();}
 function updateEffects(effects){
  const t=latestTracks.current.find(item=>item.id===selected);
  if(!t)return;
  setHistory(h=>[...h.slice(-9),latestTracks.current]);
  const before=JSON.stringify((t.effects||[]).filter(l=>l.enabled!==false)),after=JSON.stringify(effects.filter(l=>l.enabled!==false));
  const audibleChange=before!==after;
  const next=latestTracks.current.map(item=>item.id===t.id?{...item,effects,originalBuffer:item.originalBuffer||item.buffer,...(audibleChange?{buffer:item.originalBuffer||item.buffer,renderedEffects:"",processed:false}:{})}:item);
  const wasPlaying=playback.current.playing,position=playback.current.time;
  if(audibleChange&&wasPlaying)stopPlayback();
  setTracks(next);
  if(audibleChange&&wasPlaying)playTracks(next,position).catch(e=>setError(e.message));
 }
 useImperativeHandle(editorRef,()=>({
  updateEffects,
  retryEffects:()=>{fxJobs.current.get(selected)?.controller.abort();fxJobs.current.delete(selected);setTracks(current=>[...current]);}
 }));
 useEffect(()=>{
  const t=tracks.find(item=>item.id===selected);
  // Siempre hay un segmento seleccionado: sus controles se muestran bajo la línea de tiempo.
  if(!t&&tracks.length&&!recording){choose(tracks.at(-1));return;}
  onTrackSelection(t?{id:t.id,name:t.name,effects:t.effects||[],fxStatus:fxStates[t.id]?.status||(t.processed?"Efectos guardados":"Audio original · sin efectos"),fxError:fxStates[t.id]?.error||"",stats:fxStates[t.id]?.stats||null}:null);
 },[tracks,selected,fxStates,onTrackSelection,recording]);
 useEffect(()=>{
  for(const [id,job] of fxJobs.current)if(!tracks.some(t=>t.id===id)){job.controller.abort();clearTimeout(job.timer);fxJobs.current.delete(id);}
  const status=(id,value)=>setFxStates(old=>{const stats=value.stats===undefined?old[id]?.stats:value.stats;return old[id]?.status===value.status&&old[id]?.error===value.error&&old[id]?.stats===stats?old:{...old,[id]:{...value,stats}};});
  for(const t of tracks){
   const layers=t.effects||[],enabled=layers.filter(layer=>layer.enabled!==false),signature=fxSignature(layers,settings);
   const previous=fxJobs.current.get(t.id);
   if(!enabled.length){
    previous?.controller.abort();clearTimeout(previous?.timer);fxJobs.current.delete(t.id);
    if(t.originalBuffer){
     const next=latestTracks.current.map(item=>item.id===t.id?{...item,buffer:item.originalBuffer,originalBuffer:null,processed:false,renderedEffects:""}:item);
     const wasPlaying=playback.current.playing,position=playback.current.time;
     if(wasPlaying)stopPlayback();setTracks(next);
     if(wasPlaying)playTracks(next,position).catch(e=>setError(e.message));
    }
    status(t.id,{status:"Audio original · sin efectos",stats:null});continue;
   }
   if(t.renderedEffects===signature){status(t.id,{status:"Efectos activos en esta pista"});continue;}
   const source=t.originalBuffer||t.buffer;
   if(previous?.signature===signature&&previous.source===source)continue;
   previous?.controller.abort();clearTimeout(previous?.timer);
   const controller=new AbortController(),job={controller,source,signature,timer:null};fxJobs.current.set(t.id,job);
   status(t.id,{status:"Actualizando efectos…"});
   job.timer=setTimeout(()=>{
    const run=async()=>{
     if(controller.signal.aborted||!mounted.current)return;
     try{
      if(source.length*source.numberOfChannels*3>100*1024*1024)throw new Error("Recorta la pista a menos de 100 MB para usar los efectos.");
      const {blob,stats}=await processLayers(source,layers,settings,controller.signal,message=>{if(!controller.signal.aborted&&mounted.current)status(t.id,{status:message});});
      controller.signal.throwIfAborted();
      const buffer=await editingContext().decodeAudioData(await blob.arrayBuffer());
      if(controller.signal.aborted||!mounted.current)return;
      const current=latestTracks.current.find(item=>item.id===t.id);
      if(!current||fxSignature(current.effects,latestMaster.current)!==signature||(current.originalBuffer||current.buffer)!==source)return;
      const wasPlaying=playback.current.playing,position=playback.current.time;
      const next=latestTracks.current.map(item=>item.id===t.id?{...item,buffer,originalBuffer:source,renderedEffects:signature,processed:true}:item);
      if(wasPlaying)stopPlayback();setTracks(next);
      status(t.id,{status:"Efectos activos en esta pista",stats});
      if(wasPlaying)await playTracks(next,position);
     }catch(e){if(e.name!=="AbortError"&&!controller.signal.aborted&&mounted.current)status(t.id,{status:"No se pudieron actualizar los efectos",error:e.message});}
    };
    fxQueue.current=fxQueue.current.catch(()=>{}).then(run);
   },450);
  }
 },[tracks,settings]);
 useEffect(()=>()=>{for(const job of fxJobs.current.values()){job.controller.abort();clearTimeout(job.timer);}},[]);
 useEffect(()=>{
  if(!recording)return;
  const warn=e=>{e.preventDefault();e.returnValue="";};
  window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
 },[recording]);
 async function startRecording(){
  setError("");setWorking(true);stopPlayback();let stream;
  try{
   if(tracks.length>=16)throw new Error("El máximo es 16 pistas.");
   if(!navigator.mediaDevices?.getUserMedia)throw new Error("Abre el estudio en localhost o HTTPS para usar el micrófono.");
   const ctx=await audioContext();
   stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   if(!workletReady.current){await ctx.audioWorklet.addModule("/recorder-worklet.js");workletReady.current=true;}
   const source=ctx.createMediaStreamSource(stream),node=new AudioWorkletNode(ctx,"pcm-recorder"),mute=ctx.createGain();
   mute.gain.value=0;
   const session={stream,source,node,mute,chunks:[],id:crypto.randomUUID(),name:"Grabación "+new Date().toLocaleTimeString("es"),original:tracks,frames:0,lastSnapshot:0,offset:insertionPoint,laneId:destination==="new"?crypto.randomUUID():currentLane};
   session.meter=createLoudnessMeter(ctx.sampleRate);rec.current=session;setCapture({peaks:[],frames:0,lufs:null});
   node.port.onmessage=e=>{
    if(!mounted.current)return;
    session.chunks.push(e.data);session.frames+=e.data.length;session.meter.push(e.data);
    let peak=0;for(const value of e.data)peak=Math.max(peak,Math.abs(value));
    const lufs=session.meter.read();setCapture(c=>({peaks:[...c.peaks,peak],frames:session.frames,lufs}));
    if(session.frames-session.lastSnapshot>=ctx.sampleRate*5){
     session.lastSnapshot=session.frames;const buffer=capturedBuffer(session);
     const draft={id:session.id,name:session.name+" · toma provisional",gain:0,offset:session.offset,laneId:session.laneId,muted:false,buffer};
     onInvalidate();setTracks(current=>current.some(t=>t.id===session.id)?current.map(t=>t.id===session.id?draft:t):[...current,draft]);
    }
   };
   source.connect(node);node.connect(mute);mute.connect(ctx.destination);
   const analyser=ctx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.72;analyser.minDecibels=-90;analyser.maxDecibels=-12;
   source.connect(analyser);analyser.connect(mute);session.analyser=analyser;micAnalyser.current=analyser;
   setSeconds(0);setRecording(true);setReveal(session.offset);
  }catch(e){stream?.getTracks().forEach(t=>t.stop());setError(e.name==="NotAllowedError"?"Permite el acceso al micrófono en el navegador.":e.message);}finally{setWorking(false);}
 }
 async function stopRecording(){
  const r=rec.current;if(!r)return;rec.current=null;
  setWorking(true);
  r.stream.getTracks().forEach(t=>t.stop());r.source.disconnect();
  await new Promise(resolve=>{const timer=setTimeout(resolve,1500);r.node.port.onmessage=e=>{if(e.data==="flushed"){clearTimeout(timer);resolve();}else r.chunks.push(e.data);};r.node.port.postMessage("flush");});
  r.node.disconnect();r.analyser?.disconnect();micAnalyser.current=null;r.mute.disconnect();r.node.port.onmessage=null;setWorking(false);
  setRecording(false);
  const buffer=capturedBuffer(r);
  if(!buffer){setError("La grabación fue demasiado corta. Graba al menos un segundo.");return;}
  const completed={id:r.id,name:r.name,gain:0,offset:r.offset,laneId:r.laneId,muted:false,buffer};
  onInvalidate();stopPlayback();setPlayTime(0);
  setHistory(h=>[...h.slice(-9),r.original]);setTracks([...r.original,completed]);choose(completed);setDestination("current");
  setReveal(r.offset);setPlacement(p=>p==="cursor"?"end":p);

 }
 const track=tracks.find(t=>t.id===selected);
 function edit(action){
  if(!track)return;setError("");
  try{
   const ctx=editingContext(),[a,b]=selection,source=track.originalBuffer||track.buffer,duration=source.duration;
   const updated=(t,buffer)=>({...t,buffer,originalBuffer:(t.effects||[]).length?buffer:null,renderedEffects:"",processed:false});
   if(action==="split"){
    if(tracks.length>=16)throw new Error("El máximo es 16 pistas.");
    if(a<=0||a>=duration)throw new Error("Coloca Inicio dentro de la pista para dividir.");
    const left=updated(track,sliceAudio(ctx,source,0,a));
    const right={...updated(track,sliceAudio(ctx,source,a,duration)),id:crypto.randomUUID(),name:track.name+" · corte",offset:track.offset+a};
    change(tracks.flatMap(t=>t.id===track.id?[left,right]:[t]));choose(right);
   }else if(action==="extract"){
    if(a<=0||b>=duration||b<=a)throw new Error("Selecciona un tramo interior para extraerlo.");
    if(tracks.length>14)throw new Error("Necesitas espacio para dos segmentos más.");
    const parts=[[0,a],[a,b],[b,duration]].map(([start,end],i)=>({...updated(track,sliceAudio(ctx,source,start,end)),id:i===0?track.id:crypto.randomUUID(),name:track.name+" · "+(i+1),offset:track.offset+start}));
    change(tracks.flatMap(t=>t.id===track.id?parts:[t]));choose(parts[1]);
   }else{
    const buffer=action==="trim"?sliceAudio(ctx,source,a,b):deleteAudio(ctx,source,a,b);
    change(tracks.map(t=>t.id===track.id?{...updated(t,buffer),offset:action==="trim"?t.offset+a:t.offset}:t));setSelection([0,buffer.duration]);
   }
  }catch(e){setError(e.message);}
 }
 function patch(id,values){change(tracks.map(t=>t.id===id?{...t,...values}:t));}
 async function playTracks(items,requested=0,options=playOptions.current){
  stopPlayback();
  const generation=playbackSession.current.generation;
  playbackSession.current.pending=true;
  try{
   let relevant=items,origin=0;
   if(options.scope!=="all"){
    const chosen=items.find(t=>t.id===options.selected);
    if(!chosen)throw new Error("Selecciona el bloque de audio que quieres repetir.");
    relevant=options.scope==="clip"?[chosen]:items.filter(t=>(t.laneId||"primary")===(chosen.laneId||"primary"));
    relevant=relevant.filter(t=>!t.muted);
    if(!relevant.length)throw new Error("El audio seleccionado está silenciado.");
    origin=Math.min(...relevant.map(t=>t.offset));
    relevant=relevant.map(t=>({...t,offset:t.offset-origin}));
   }
   const ctx=await audioContext();
   if(generation!==playbackSession.current.generation||!mounted.current)return;
   const buffer=mixTracks(ctx,relevant),source=ctx.createBufferSource();
   const local=requested-origin,position=local<0||local>=buffer.duration?0:local,startedAt=ctx.currentTime;
   source.buffer=buffer;source.loop=options.loop;source.loopStart=0;source.loopEnd=buffer.duration;
   if(!outputAnalyser.current||outputAnalyser.current.context!==ctx){
    const analyser=ctx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.72;analyser.minDecibels=-90;analyser.maxDecibels=-12;
    analyser.connect(ctx.destination);outputAnalyser.current=analyser;
   }
   source.connect(outputAnalyser.current);
   source.onended=()=>{
    if(generation!==playbackSession.current.generation)return;
    cancelAnimationFrame(frame.current);sources.current=[];source.disconnect();
    playback.current.playing=false;
    if(mounted.current){setPlaying(false);setPlayTime(origin+buffer.duration);}
   };
   sources.current=[source];source.start(0,position);playbackSession.current.pending=false;
   playback.current.playing=true;setPlaying(true);setPlayTime(origin+position);setLoopCycle(0);
   const tick=()=>{
    if(!mounted.current||generation!==playbackSession.current.generation)return;
    const elapsed=position+ctx.currentTime-startedAt;
    const relative=source.loop?elapsed%buffer.duration:Math.min(buffer.duration,elapsed);
    setPlayTime(origin+relative);setLoopCycle(source.loop?Math.floor(elapsed/buffer.duration):0);
    frame.current=requestAnimationFrame(tick);
   };
   frame.current=requestAnimationFrame(tick);
  }catch(e){if(generation===playbackSession.current.generation)stopPlayback();throw e;}
 }
 function changePlaybackOptions(patch){
  const options={...playOptions.current,...patch};
  playOptions.current=options;setLoopEnabled(options.loop);setPlayScope(options.scope);
  if(playback.current.playing||playbackSession.current.pending){const position=playback.current.time;stopPlayback();playTracks(latestTracks.current,position,options).catch(e=>setError(e.message));}
 }
 const previousSoloSelection=useRef(selected);
 useEffect(()=>{
  const changed=previousSoloSelection.current!==selected;previousSoloSelection.current=selected;
  if(!changed||playOptions.current.scope==="all"||(!playback.current.playing&&!playbackSession.current.pending))return;
  const position=playback.current.time;stopPlayback();
  if(selected)playTracks(latestTracks.current,position).catch(e=>setError(e.message));
 },[selected]);
 async function play(){if(playing||playbackSession.current.pending){stopPlayback();return;}setError("");try{await playTracks(tracks,playTime);}catch(e){setError(e.message);}}
 async function applyTempo(){
  if(!track)return;setWorking(true);setError("");stopPlayback();
  try{
   const source=track.originalBuffer||track.buffer,blob=await changeTempo(source,tempo);
   const buffer=await editingContext().decodeAudioData(await blob.arrayBuffer());
   change(latestTracks.current.map(t=>t.id===track.id?{...t,buffer,originalBuffer:(t.effects||[]).length?buffer:null,renderedEffects:"",processed:false}:t));
   setSelection([0,buffer.duration]);setTempo(1);
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 function removeTrack(id){
  fxJobs.current.get(id)?.controller.abort();
  change(latestTracks.current.filter(t=>t.id!==id));
  if(selected===id)setSelected(null);
 }
 async function replaceOriginal(file){
  if(!file||!track)return;setWorking(true);setError("");
  try{
   if(!/\.(wav|mp3)$/i.test(file.name)||file.size>100*1024*1024)throw new Error("Usa WAV o MP3 de hasta 100 MB.");
   const ctx=await audioContext(),buffer=await ctx.decodeAudioData(await file.arrayBuffer());
   if(buffer.duration>900||buffer.numberOfChannels>2)throw new Error("Usa audio mono o estéreo de hasta 15 minutos.");
   change(latestTracks.current.map(t=>t.id===track.id?{...t,buffer,originalBuffer:null,effects:[],renderedEffects:"",processed:false,sourceDescription:"Archivo original restaurado"}:t));
   setSelection([0,buffer.duration]);
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 function combineTracks(){
  setError("");
  try{
   if(fxPending)throw new Error("Espera a que terminen los efectos.");
   const active=tracks.filter(t=>!t.muted);
   if(active.length<2)throw new Error("Activa al menos dos pistas para combinarlas.");
   const buffer=mixTracks(editingContext(),active);
   const combined={id:crypto.randomUUID(),name:"Pistas combinadas",laneId:currentLane,offset:0,gain:0,muted:false,buffer,effects:[],processed:false,sourceDescription:"Mezcla: efectos incorporados al audio"};
   change([...tracks.filter(t=>t.muted),combined]);choose(combined);
  }catch(e){setError(e.message);}
 }
 function beginMove(e,t){
  if(locked)return;e.preventDefault();choose(t);
  e.currentTarget.setPointerCapture(e.pointerId);
  const lane=e.currentTarget.closest(".timeline-lane");
  drag.current={id:t.id,start:e.clientX,offset:t.offset,scroll:viewport.current.scrollLeft,scale:lane.clientWidth/timelineSpan};
  setDragPreview({id:t.id,offset:t.offset});
 }
 function moveClip(e){
  const d=drag.current;if(!d)return;
  if(!d.stopped&&Math.abs(e.clientX-d.start)>2){stopPlayback();d.stopped=true;}
  const box=viewport.current.getBoundingClientRect();
  if(e.clientX>box.right-35)viewport.current.scrollLeft+=18;
  if(e.clientX<box.left+35)viewport.current.scrollLeft-=18;
  const offset=Math.round(Math.max(0,Math.min(900,(e.clientX-d.start+viewport.current.scrollLeft-d.scroll)/d.scale+d.offset))*100)/100;
  d.latest=offset;setDragPreview({id:d.id,offset});
 }
 function endMove(){
  const d=drag.current;if(!d)return;drag.current=null;
  if(d.latest!==undefined&&d.latest!==d.offset)change(latestTracks.current.map(t=>t.id===d.id?{...t,offset:d.latest}:t));
  setDragPreview(null);
 }
 async function exportMix(){
  setWorking(true);setError("");
  try{
   if(fxPending)throw new Error("Espera a que terminen de actualizarse los efectos.");
   const buffer=mixTracks(editingContext(),tracks);download(buffer,"VoiceMaster-mezcla.wav");
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 return <section className="panel multitrack" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!locked)importFiles(Array.from(e.dataTransfer.files));}}>
  <div className="project-bar">
   <div><input aria-label="Nombre del proyecto" maxLength="150" disabled={locked} value={store.project?.name||""} placeholder="Cargando proyecto…" onChange={e=>store.rename(e.target.value)}/><small role="status" data-testid="save-status">{store.status}</small></div>
   <select aria-label="Abrir proyecto" disabled={locked} value={store.project?.id||""} onChange={e=>store.open(e.target.value)}><option value="" disabled>Mis proyectos</option>{store.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
   <details ref={menu} className="studio-menu"><summary><Plus size={16}/> Menú del estudio <ChevronDown size={14}/></summary><div className="menu-popover">
    <button disabled={locked} onClick={()=>{closeMenu();setMode("record");}}><Mic size={16}/><span>Grabar<small>Abrir el micrófono</small></span></button>
    <button disabled={locked} onClick={()=>{closeMenu();setMode("import");}}><FolderOpen size={16}/><span>Importar archivo<small>Añadir WAV o MP3</small></span></button>
    <button disabled={locked} onClick={()=>{closeMenu();setDestination("new");setMode("import");}}><Plus size={16}/><span>Crear otra pista<small>Voz y música en filas separadas</small></span></button>
    <button disabled={locked||!selected} onClick={()=>{closeMenu();onShowEffects();}}><SlidersHorizontal size={16}/><span>Agregar efecto<small>Podcast y ambientes</small></span></button>
    <button disabled={locked||!tracks.length} onClick={()=>{closeMenu();setMode("export");}}><Download size={16}/><span>Exportar<small>Audacity / DaVinci Resolve</small></span></button>
    <hr/><button disabled={locked} onClick={()=>{closeMenu();store.save();}}><Save size={16}/>Guardar proyecto</button>
    <button disabled={locked} onClick={()=>{closeMenu();setMode(null);store.create();}}><Plus size={16}/>Nuevo proyecto</button>
    <button disabled={locked} onClick={()=>{closeMenu();store.duplicate();}}><Copy size={16}/>Duplicar proyecto</button>
   </div></details>
  </div>
  {store.error&&<div role="alert" className="error">{store.error} {!store.ready&&<button onClick={()=>location.reload()}>Reintentar</button>}</div>}
  {mode&&<div className="context-panel"><button aria-label="Cerrar panel" className="close-panel" disabled={recording} onClick={()=>setMode(null)}><X size={15}/></button>
   {mode==="record"&&<><h2>Graba una nueva toma</h2><p>La toma aparece a continuación del audio. Haz clic en la regla o en un hueco de la línea de tiempo para empezarla en otro punto. Máximo 10 minutos por toma.</p><button disabled={disabled||working||!store.ready||store.switching} className={recording?"record recording":"record"} onClick={recording?stopRecording:startRecording}>{recording?<Square size={15}/>:<Mic size={15}/>} {recording?"Detener · "+clock(seconds):"Grabar voz"}</button></>}
   {recording&&<LiveRecording peaks={capture.peaks} frames={capture.frames} lufs={capture.lufs} target={Number(settings.loudness)} rate={context.current?.sampleRate||RATE}/>}
   {mode==="import"&&<><h2>Importa tus pistas</h2><p>Arrastra archivos WAV o MP3 aquí, o selecciónalos desde tu equipo.</p><button disabled={locked} onClick={()=>input.current.click()}><Plus size={15}/>Añadir pistas</button></>}
   {mode==="export"&&<><h2>Continúa en tu editor favorito</h2><p>WAV de 24 bits y 48 kHz para importar en Audacity o DaVinci Resolve. Exporta la mezcla o cada pista desde su fila.</p><button disabled={locked||!tracks.length} onClick={()=>exportMix()}><Download size={15}/>Exportar mezcla WAV</button></>}
  </div>}
  <div className="editor-toolbar compact-toolbar">
   <button disabled={locked} onClick={()=>{menu.current.open=true;menu.current.scrollIntoView({block:"nearest"});}}><Plus size={15}/>Añadir audio</button>
   <button disabled={locked||fxPending||tracks.filter(t=>!t.muted).length<2} onClick={combineTracks}><AudioLines size={15}/>Combinar en una</button>
   <button disabled={locked||!tracks.length} onClick={play}>{playing?<Square size={15}/>:<Play size={15}/>} {playing?"Detener":playScope==="all"?"Escuchar mezcla":playScope==="lane"?"Reproducir pista":"Reproducir segmento"}</button>
   <button disabled={locked||!history.length} onClick={()=>{stopPlayback();setPlayTime(0);const previous=history.at(-1);onInvalidate();setTracks(previous);setHistory(h=>h.slice(0,-1));if(previous.length)choose(previous[0]);else setSelected(null);}}><Undo2 size={15}/>Deshacer</button>
   <label className="loop-control" title="Repite la reproducción; no modifica ni alarga el archivo exportado"><input type="checkbox" aria-label="Loop" disabled={locked||!tracks.length} checked={loopEnabled} onChange={e=>changePlaybackOptions({loop:e.target.checked})}/>Loop</label>
   <label className="placement">Reproducir<select aria-label="Alcance de reproducción" disabled={locked||!tracks.length} value={playScope} onChange={e=>changePlaybackOptions({scope:e.target.value})}><option value="all">Toda la grabación</option><option value="clip" disabled={!selected}>Pista / audio seleccionado</option><option value="lane" disabled={!selected}>Fila completa seleccionada</option></select></label>
   {playScope!=="all"&&track&&<span className="loop-target" data-testid="loop-target">{playScope==="clip"?"Solo audio: ":"Fila de: "}{track.name}</span>}
   {playing&&loopEnabled&&<span className="loop-cycle" data-testid="loop-cycle">Vuelta {loopCycle+1}</span>}
   <label className="placement">Destino<select aria-label="Pista de destino" disabled={locked} value={destination} onChange={e=>setDestination(e.target.value)}><option value="current">Pista actual</option><option value="new">Nueva pista</option></select></label>
   <label className="placement">Añadir audio<select aria-label="Posición del audio nuevo" disabled={locked} value={placement} onChange={e=>setPlacement(e.target.value)}><option value="end">Al final</option><option value="cursor">En el cursor</option><option value="overlap">Superponer</option></select></label>
   <label className="placement">Zoom<select aria-label="Zoom de la línea de tiempo" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value="32">32 px/s</option><option value="64">64 px/s</option><option value="128">128 px/s</option></select></label>
   <span className="track-count">{rows.length} pistas · {tracks.length} segmentos</span>
  </div>
  <input hidden ref={replacePicker} type="file" accept=".wav,.mp3" onChange={e=>{replaceOriginal(e.target.files[0]);e.target.value="";}}/>
  <input hidden multiple type="file" accept=".wav,.mp3" ref={input} onChange={e=>{importFiles(Array.from(e.target.files));e.target.value="";}}/>
  {!tracks.length&&<div className="empty-editor"><Plus size={26}/><h2>Un espacio para tu próxima idea.</h2><p>Abre el menú superior para grabar o importar una pista.</p></div>}
  {track&&<div className="edit-menu-bar"><span>PISTA SELECCIONADA · {track.name}</span><button className="remove-selected" disabled={locked} onClick={()=>removeTrack(track.id)}><Trash2 size={14}/>Eliminar segmento</button><details className="edit-actions"><summary><Scissors size={14}/>Editar pista<ChevronDown size={14}/></summary><div className="selection-tools"><label>Inicio (s)<input type="number" disabled={locked} min="0" max={track.buffer.duration} step="0.01" value={selection[0]} onChange={e=>setSelection([Math.max(0,Math.min(selection[1],Number(e.target.value)||0)),selection[1]])}/></label><label>Fin (s)<input type="number" disabled={locked} min={selection[0]} max={track.buffer.duration} step="0.01" value={selection[1]} onChange={e=>setSelection([selection[0],Math.max(selection[0],Math.min(track.buffer.duration,Number(e.target.value)||0))])}/></label><button disabled={locked} onClick={()=>edit("trim")}><Scissors size={14}/>Conservar selección</button><button disabled={locked} onClick={()=>edit("delete")}><Trash2 size={14}/>Borrar selección</button><button disabled={locked} onClick={()=>edit("split")}>Dividir en Inicio</button>
 <button disabled={locked} onClick={()=>edit("extract")}>Separar selección</button>
 <button disabled={locked} onClick={()=>patch(track.id,{offset:playTime})}>Mover al cursor</button>
 <button disabled={locked} onClick={()=>replacePicker.current.click()}>Restaurar desde archivo original</button>
 <button disabled={locked||!(track.effects||[]).length} onClick={()=>updateEffects([])}>Quitar todos los efectos de esta pista</button>
 <label>Velocidad<select aria-label="Velocidad del segmento" disabled={locked||fxPending} value={tempo} onChange={e=>setTempo(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(v=><option value={v} key={v}>{v}×</option>)}</select></label><button disabled={locked||fxPending||tempo===1} onClick={applyTempo}>Cambiar velocidad conservando tono</button></div></details></div>}
  {(!!tracks.length||recording)&&<NeonSpectrum analyser={recording?micAnalyser.current:outputAnalyser.current} active={recording||playing} recording={recording}/>}
  {!!tracks.length&&<div className="transport">
   <div><strong>REPRODUCCIÓN</strong><output data-testid="playback-time">{clock(playTime)} / {clock(duration)}</output></div>
   <input aria-label="Posición de reproducción" disabled={locked} type="range" min="0" max={duration||1} step="0.01" value={Math.min(playTime,duration)} onChange={e=>{stopPlayback();setPlayTime(Number(e.target.value));}} style={{"--fill":(duration?playTime/duration*100:0)+"%","--accent":"#e4b47d"}}/>

  </div>}
  <div className="timeline-viewport" ref={viewport}><div className="timeline-content" style={{width:timelineWidth}}>
  <div className="time-ruler timeline-ruler" title="Haz clic o arrastra para mover el cursor" onPointerDown={seek} {...scrubbing}>{Array.from({length:11},(_,i)=><span key={i}>{clock(timelineSpan*i/10)}</span>)}{(mode==="record"||mode==="import")&&!recording&&!!tracks.length&&<i className="insert-marker" style={{left:pct(insertionPoint)}}><span>Nueva toma</span></i>}<span aria-hidden="true" className="playhead grab" style={{left:pct(Math.min(playTime,timelineSpan))}}/></div>
  <div className="track-list">{rows.map((row,r)=><div className="timeline-lane" key={r} data-lane={row[0]?.laneId||"primary"} onPointerDown={e=>{if(e.target===e.currentTarget)seek(e);}} {...scrubbing}>
   <span className="lane-number">Pista {r+1}</span>{row.map(c=>c.ghost?<article key={c.id} className="clip recording-clip" style={{left:pct(c.offset),width:pct(c.duration)}}><span><Mic size={12}/>Grabando · {clock(c.duration)}</span></article>
   :<article key={c.id} data-name={c.track.name} data-offset={c.track.offset} className={"clip audio-track"+(selected===c.id?" selected":"")+(c.track.muted?" muted":"")+(dragPreview?.id===c.id?" dragging":"")} style={{left:pct(dragPreview?.id===c.id?dragPreview.offset:c.offset),width:pct(c.duration)}}>
    <button className="clip-handle" aria-label={"Mover segmento "+c.track.name} disabled={locked} onPointerDown={e=>beginMove(e,c.track)} onPointerMove={moveClip} onPointerUp={endMove} onPointerCancel={endMove}><GripHorizontal size={13}/><span>{c.track.name}</span></button>
    <Waveform track={c.track} disabled={locked} selection={selected===c.id?selection:null} onSelect={range=>{setSelected(c.id);setSelection(range);}}/>
   </article>)}
   <span aria-hidden="true" className="playhead grab" data-testid="playhead" title="Arrastra para mover el cursor" style={{left:pct(Math.min(playTime,timelineSpan))}} onPointerDown={seek} {...scrubbing}/>
  </div>)}</div></div></div>
  {track&&(t=>{const i=tracks.indexOf(t);return <div className="clip-inspector" key={t.id}>
   <div className="track-heading"><button className="track-name" disabled={locked} onClick={()=>choose(t)}>{String(i+1).padStart(2,"0")} · {t.name}</button>{(t.effects||[]).some(l=>l.enabled!==false)&&<span className="applied-badge">{t.renderedEffects===fxSignature(t.effects,settings)?"FX activos":"Actualizando FX…"}</span>}{t.sourceDescription&&<span className="source-description">{t.sourceDescription}</span>}<span>{clock(t.buffer.duration)}</span><button aria-label={t.muted?"Activar pista":"Silenciar pista"} disabled={locked} onClick={()=>patch(t.id,{muted:!t.muted})}>{t.muted?<VolumeX size={15}/>:<Volume2 size={15}/>}</button><button aria-label="Eliminar pista" disabled={locked} onClick={()=>removeTrack(t.id)}><Trash2 size={15}/></button></div>
   <div className="track-fields"><button disabled={locked||t.muted} className="solo-loop-button" onClick={()=>{
    const options={loop:true,scope:"clip",selected:t.id};
    playOptions.current=options;setLoopEnabled(true);setPlayScope("clip");setError("");
    playTracks(latestTracks.current,t.offset,options).catch(e=>setError(e.message));
   }}><Play size={14}/>Reproducir este audio en loop</button>{(t.effects||[]).length?<span className="track-effect-summary">{t.effects.filter(l=>l.enabled!==false).length} activos · {t.effects.length} agregados</span>:<button disabled={locked} onClick={()=>prepareTrack(t)}>Mejorar voz</button>}<label>Posición (s)<input disabled={locked} type="number" min="0" max="900" step="0.01" value={t.offset} onChange={e=>patch(t.id,{offset:Math.max(0,Math.min(900,Number(e.target.value)||0))})}/></label><label>Volumen (dB)<input disabled={locked} type="number" min="-60" max="12" value={t.gain} onChange={e=>patch(t.id,{gain:Math.max(-60,Math.min(12,Number(e.target.value)||0))})}/></label><button disabled={locked||fxPending} onClick={()=>{try{download(mixTracks(editingContext(),[{...t,offset:0,muted:false}]),t.name+".wav");}catch(e){setError(e.message);}}}><Download size={14}/>WAV de pista</button></div>
  </div>;})(track)}

  {error&&<div role="alert" className="error">{error}</div>}
  {!!tracks.length&&<div className="editor-export"><button disabled={locked||fxPending} onClick={exportMix}><Download size={15}/>Exportar mezcla WAV</button><span className="control-note">{fxPending?"Actualizando efectos…":"Los WAV incluyen los efectos activos."}</span></div>}

  <p className="control-note">Las tomas nuevas aparecen a continuación del audio; haz clic en la regla o en un hueco para empezar en otro punto. Arrastra la cabecera del segmento para moverlo; arrastra sobre la onda para seleccionar. Posición coloca cada pista en la mezcla. Las pistas exportadas comienzan en cero; la mezcla conserva sus posiciones. El proyecto se guarda automáticamente. Combinar une las pistas activas e incorpora sus efectos; Deshacer las separa durante esta sesión.</p>
 </section>;
}
