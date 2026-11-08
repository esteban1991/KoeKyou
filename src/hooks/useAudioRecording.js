import {useEffect,useRef,useState} from "react";
import {createLoudnessMeter} from "../loudness";
const MAX_SECONDS=600;
// Graba PCM sin compresión con un AudioWorklet; cada 5 s entrega un segmento provisional recuperable.
export function useAudioRecording({engine,onError,onDraft,onComplete}){
 const [recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[seconds,setSeconds]=useState(0),[capture,setCapture]=useState({peaks:[],frames:0,lufs:null});
 const rec=useRef(null),workletReady=useRef(false),micAnalyser=useRef(null);
 const handlers=useRef();handlers.current={onError,onDraft,onComplete};
 useEffect(()=>{if(!recording)return;const timer=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(timer);},[recording]);
 useEffect(()=>{if(seconds>=MAX_SECONDS&&recording)stop();},[seconds,recording]);
 useEffect(()=>{
  if(!recording)return;
  const warn=e=>{e.preventDefault();e.returnValue="";};
  window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
 },[recording]);
 useEffect(()=>()=>{const r=rec.current;if(r){r.stream.getTracks().forEach(t=>t.stop());r.node.disconnect();r.source.disconnect();}},[]);
 function capturedBuffer(session){
  const ctx=engine.context.current,length=session.chunks.reduce((sum,c)=>sum+c.length,0);
  if(!length)return null;
  const buffer=ctx.createBuffer(1,length,ctx.sampleRate);
  let offset=0;for(const chunk of session.chunks){buffer.getChannelData(0).set(chunk,offset);offset+=chunk.length;}
  return buffer;
 }
 // `take` lleva dónde empieza el segmento (offset, laneId) y el proyecto previo para deshacer.
 async function start(take){
  setBusy(true);let stream;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error("Abre el estudio en localhost o HTTPS para usar el micrófono.");
   const ctx=await engine.audioContext();
   stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   if(!workletReady.current){await ctx.audioWorklet.addModule("/recorder-worklet.js");workletReady.current=true;}
   const source=ctx.createMediaStreamSource(stream),node=new AudioWorkletNode(ctx,"pcm-recorder"),mute=ctx.createGain();
   mute.gain.value=0;
   const session={...take,stream,source,node,mute,chunks:[],id:crypto.randomUUID(),name:"Grabación "+new Date().toLocaleTimeString("es"),frames:0,lastSnapshot:0,meter:createLoudnessMeter(ctx.sampleRate)};
   rec.current=session;setCapture({peaks:[],frames:0,lufs:null});
   node.port.onmessage=e=>{
    if(!engine.mounted.current)return;
    session.chunks.push(e.data);session.frames+=e.data.length;session.meter.push(e.data);
    let peak=0;for(const value of e.data)peak=Math.max(peak,Math.abs(value));
    const lufs=session.meter.read();setCapture(c=>({peaks:[...c.peaks,peak],frames:session.frames,lufs}));
    if(session.frames-session.lastSnapshot>=ctx.sampleRate*5){
     session.lastSnapshot=session.frames;
     handlers.current.onDraft({id:session.id,name:session.name+" · provisional",gain:0,offset:session.offset,laneId:session.laneId,muted:false,buffer:capturedBuffer(session)});
    }
   };
   source.connect(node);node.connect(mute);mute.connect(ctx.destination);
   const analyser=ctx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.72;analyser.minDecibels=-90;analyser.maxDecibels=-12;
   source.connect(analyser);analyser.connect(mute);session.analyser=analyser;micAnalyser.current=analyser;
   setSeconds(0);setRecording(true);return true;
  }catch(e){stream?.getTracks().forEach(t=>t.stop());handlers.current.onError(e.name==="NotAllowedError"?"Permite el acceso al micrófono en el navegador.":e.message);return false;}finally{setBusy(false);}
 }
 async function stop(){
  const r=rec.current;if(!r)return;rec.current=null;
  setBusy(true);
  r.stream.getTracks().forEach(t=>t.stop());r.source.disconnect();
  await new Promise(resolve=>{const timer=setTimeout(resolve,1500);r.node.port.onmessage=e=>{if(e.data==="flushed"){clearTimeout(timer);resolve();}else r.chunks.push(e.data);};r.node.port.postMessage("flush");});
  r.node.disconnect();r.analyser?.disconnect();micAnalyser.current=null;r.mute.disconnect();r.node.port.onmessage=null;
  setBusy(false);setRecording(false);
  const buffer=capturedBuffer(r);
  if(!buffer){handlers.current.onError("La grabación fue demasiado corta. Graba al menos un segundo.");return;}
  handlers.current.onComplete({id:r.id,name:r.name,gain:0,offset:r.offset,laneId:r.laneId,muted:false,buffer},r.original);
 }
 // Segmento fantasma que crece en la línea de tiempo mientras se graba.
 const liveTake=recording&&rec.current?{id:rec.current.id,ghost:true,offset:rec.current.offset,laneId:rec.current.laneId,duration:Math.max(.2,capture.frames/engine.sampleRate())}:null;
 return {recording,busy,seconds,capture,micAnalyser,liveTake,start,stop};
}
