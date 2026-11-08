import {useEffect,useRef,useState} from "react";
const API="http://127.0.0.1:8000";
async function request(path,options){
 const response=await fetch(API+"/projects"+path,options);
 if(!response.ok){
  const body=await response.json().catch(()=>({})),detail=body.detail;
  const error=new Error(typeof detail==="string"?detail:detail?.message||"No se pudo acceder a la base de proyectos.");
  error.missing=detail?.missing;throw error;
 }
 return response;
}
// PCM de un AudioBuffer con los canales seguidos, tal como se guarda en SQLite.
const pcmOf=buffer=>new Blob(Array.from({length:buffer.numberOfChannels},(_,c)=>buffer.getChannelData(c)),{type:"application/octet-stream"});
// Los AudioBuffer no se modifican tras crearse (cada edición crea uno nuevo), así que su hash
// se calcula una sola vez. SHA-256 porque WebCrypto no incluye MD5.
const hashes=new WeakMap();
function hashOf(buffer){
 if(!hashes.has(buffer))hashes.set(buffer,pcmOf(buffer).arrayBuffer().then(data=>crypto.subtle.digest("SHA-256",data)).then(d=>Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("")));
 return hashes.get(buffer);
}
function fromPcm(pcm,frames,channels,sampleRate){
 const buffer=new AudioBuffer({length:frames,numberOfChannels:channels,sampleRate});
 for(let c=0;c<channels;c++)buffer.copyToChannel(pcm.subarray(c*frames,(c+1)*frames),c);
 return buffer;
}
export function useProjectStore({tracks,setTracks,settings,preset,onSettings,onReset}){
 const [project,setProject]=useState(null),[projects,setProjects]=useState([]),[ready,setReady]=useState(false),[switching,setSwitching]=useState(false);
 const [status,setStatus]=useState("Cargando proyectos…"),[error,setError]=useState("");
 const timer=useRef(null),queue=useRef(Promise.resolve()),dirty=useRef(false),alive=useRef(true),latest=useRef(null),generation=useRef(0),stored=useRef(new Set());
 latest.current={tracks,settings,preset,project,onSettings,onReset};
 const refresh=async()=>{const rows=await(await request("")).json();if(alive.current)setProjects(rows);return rows;};
 const remember=id=>{try{localStorage.setItem("voicemaster-project",id);}catch{}};
 function saveSnapshot(snapshot){
  const task=async()=>{
   if(!snapshot.project)return;
   if(alive.current)setStatus("Guardando…");
   const audio=await Promise.all(snapshot.tracks.map(async t=>({...t,buffer:undefined,originalBuffer:undefined,hash:await hashOf(t.buffer),originalHash:t.originalBuffer?await hashOf(t.originalBuffer):"",originalFrames:t.originalBuffer?.length||0,originalChannels:t.originalBuffer?.numberOfChannels||0,channels:t.buffer.numberOfChannels,frames:t.buffer.length,sampleRate:t.buffer.sampleRate})));
   const buffers=new Map();
   snapshot.tracks.forEach((t,i)=>{buffers.set(audio[i].hash,t.buffer);if(t.originalBuffer)buffers.set(audio[i].originalHash,t.originalBuffer);});
   // Solo viaja el audio que el servidor no tiene; si borró alguno, pide reenviarlo (409).
   const send=async keys=>{
    const form=new FormData();
    form.append("manifest",JSON.stringify({name:snapshot.project.name,settings:snapshot.settings,preset:snapshot.preset,tracks:audio}));
    keys.forEach(key=>form.append("blobs",pcmOf(buffers.get(key)),key));
    await request("/"+snapshot.project.id,{method:"PUT",body:form});
   };
   try{await send([...buffers.keys()].filter(key=>!stored.current.has(key)));}
   catch(e){if(!e.missing)throw e;e.missing.forEach(key=>stored.current.delete(key));await send(e.missing.filter(key=>buffers.has(key)));}
   for(const key of buffers.keys())stored.current.add(key);
   if(alive.current&&latest.current.project?.id===snapshot.project.id){
    const now=latest.current;
    const unchanged=now.tracks===snapshot.tracks&&now.settings===snapshot.settings&&now.preset===snapshot.preset&&now.project.name===snapshot.project.name;
    if(unchanged){dirty.current=false;setStatus("Guardado localmente");setError("");}
   }
   await refresh();
  };
  const result=queue.current.catch(()=>{}).then(task);queue.current=result;return result;
 }
 async function save(){
  clearTimeout(timer.current);
  try{await saveSnapshot(latest.current);}catch(e){if(alive.current){setStatus("No se pudo guardar");setError(e.message);}throw e;}
 }
 async function load(id){
  const state=await(await request("/"+id)).json();
  const buffers=await Promise.all(state.tracks.map(async(t,i)=>{
   // El hash guardado identifica el buffer: el próximo guardado no vuelve a enviarlo.
   const fetchPcm=async(key,length,message)=>{
    const pcm=new Float32Array(await(await request("/"+id+"/blobs/"+key)).arrayBuffer());
    if(pcm.length!==length)throw new Error(message);
    return pcm;
   };
   const buffer=fromPcm(await fetchPcm(t.hash,t.channels*t.frames,"Un segmento guardado está incompleto."),t.frames,t.channels,t.sampleRate);
   hashes.set(buffer,Promise.resolve(t.hash));stored.current.add(t.hash);
   let originalBuffer=null;
   if(t.originalFrames){
    originalBuffer=fromPcm(await fetchPcm(t.originalHash,t.originalFrames*t.originalChannels,"La fuente original está incompleta."),t.originalFrames,t.originalChannels,t.sampleRate);
    hashes.set(originalBuffer,Promise.resolve(t.originalHash));stored.current.add(t.originalHash);
   }
   return {id:t.id,laneId:t.laneId||"primary",name:t.name,gain:t.gain,offset:t.offset,muted:t.muted,processed:t.processed||false,sourceDescription:t.sourceDescription||"",effects:t.effects||[],renderedEffects:t.renderedEffects||"",duck:t.duck||0,fadeIn:t.fadeIn||0,fadeOut:t.fadeOut||0,buffer,originalBuffer};
  }));
  if(!alive.current)return;
  latest.current.onReset();setTracks(buffers);latest.current.onSettings(state.settings,state.preset);
  setProject({id,name:state.name});remember(id);dirty.current=false;setReady(true);setStatus("Guardado localmente");
 }
 async function create(){
  const id=crypto.randomUUID(),name="Proyecto "+new Date().toLocaleString("es");
  const form=new FormData();form.append("manifest",JSON.stringify({name,settings:{depth:4,clarity:3,compression:55,cleanup:25},preset:"podcast",tracks:[]}));
  await request("/"+id,{method:"PUT",body:form});return id;
 }
 useEffect(()=>{
  alive.current=true;const token=++generation.current;
  (async()=>{
   try{
    const rows=await refresh();if(token!==generation.current)return;let last;try{last=localStorage.getItem("voicemaster-project");}catch{}
    const id=rows.find(p=>p.id===last)?.id||rows[0]?.id||await create();
    await load(id);await refresh();
   }catch(e){if(alive.current){setStatus("Base de proyectos no disponible");setError(e.message);}}
  })();
  const unload=e=>{if(dirty.current){e.preventDefault();e.returnValue="";}};
  window.addEventListener("beforeunload",unload);
  return()=>{alive.current=false;clearTimeout(timer.current);window.removeEventListener("beforeunload",unload);};
 },[]);
 useEffect(()=>{
  if(!ready||!project||switching)return;
  dirty.current=true;setStatus("Cambios pendientes…");clearTimeout(timer.current);
  const snapshot={...latest.current};
  timer.current=setTimeout(()=>saveSnapshot(snapshot).catch(e=>{if(alive.current){setStatus("No se pudo guardar");setError(e.message);}}),700);
  return()=>clearTimeout(timer.current);
 },[tracks,settings,preset,project,ready,switching]);
 async function action(kind,id){
  if(switching)return;
  setSwitching(true);setError("");clearTimeout(timer.current);
  try{
   await save();
   if(kind==="new")id=await create();
   if(kind==="duplicate")id=(await(await request("/"+latest.current.project.id+"/duplicate",{method:"POST"})).json()).id;
   await load(id);await refresh();
  }catch(e){setError(e.message);}finally{setSwitching(false);}
 }
 return {project,projects,ready,switching,status,error,rename:name=>setProject(p=>({...p,name:name.slice(0,150)||"Sin título"})),save:()=>save().catch(()=>{}),open:id=>action("open",id),create:()=>action("new"),duplicate:()=>action("duplicate")};
}
