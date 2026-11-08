import {useEffect,useRef,useState} from "react";
const API="http://127.0.0.1:8000";
async function request(path,options){
 const response=await fetch(API+"/projects"+path,options);
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(typeof body.detail==="string"?body.detail:"No se pudo acceder a la base de proyectos.");}
 return response;
}
export function useProjectStore({tracks,setTracks,settings,preset,onSettings,onReset}){
 const [project,setProject]=useState(null),[projects,setProjects]=useState([]),[ready,setReady]=useState(false),[switching,setSwitching]=useState(false);
 const [status,setStatus]=useState("Cargando proyectos…"),[error,setError]=useState("");
 const timer=useRef(null),queue=useRef(Promise.resolve()),dirty=useRef(false),alive=useRef(true),latest=useRef(null),generation=useRef(0);
 latest.current={tracks,settings,preset,project,onSettings,onReset};
 const refresh=async()=>{const rows=await(await request("")).json();if(alive.current)setProjects(rows);return rows;};
 const remember=id=>{try{localStorage.setItem("voicemaster-project",id);}catch{}};
 function saveSnapshot(snapshot){
  const task=async()=>{
   if(!snapshot.project)return;
   if(alive.current)setStatus("Guardando…");
   const audio=snapshot.tracks.map(t=>({...t,buffer:undefined,originalBuffer:undefined,originalFrames:t.originalBuffer?.length||0,originalChannels:t.originalBuffer?.numberOfChannels||0,channels:t.buffer.numberOfChannels,frames:t.buffer.length,sampleRate:t.buffer.sampleRate}));
   const form=new FormData();
   form.append("manifest",JSON.stringify({name:snapshot.project.name,settings:snapshot.settings,preset:snapshot.preset,tracks:audio}));
   snapshot.tracks.forEach(t=>{const channels=Array.from({length:t.buffer.numberOfChannels},(_,c)=>t.buffer.getChannelData(c));form.append("audio",new Blob(channels,{type:"application/octet-stream"}),"track.pcm");});
   snapshot.tracks.filter(t=>t.originalBuffer).forEach(t=>{
    form.append("originals",new Blob(Array.from({length:t.originalBuffer.numberOfChannels},(_,c)=>t.originalBuffer.getChannelData(c))),"original.pcm");
   });
   await request("/"+snapshot.project.id,{method:"PUT",body:form});
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
   const pcm=new Float32Array(await(await request("/"+id+"/tracks/"+i)).arrayBuffer());
   if(pcm.length!==t.channels*t.frames)throw new Error("Un segmento guardado está incompleto.");
   const buffer=new AudioBuffer({length:t.frames,numberOfChannels:t.channels,sampleRate:t.sampleRate});
   for(let c=0;c<t.channels;c++)buffer.copyToChannel(pcm.subarray(c*t.frames,(c+1)*t.frames),c);
   let originalBuffer=null;
   if(t.originalFrames){
    const original=new Float32Array(await(await request("/"+id+"/tracks/"+i+"?original=true")).arrayBuffer());
    if(original.length!==t.originalFrames*t.originalChannels)throw new Error("La fuente original está incompleta.");
    originalBuffer=new AudioBuffer({length:t.originalFrames,numberOfChannels:t.originalChannels,sampleRate:t.sampleRate});
    for(let c=0;c<t.originalChannels;c++)originalBuffer.copyToChannel(original.subarray(c*t.originalFrames,(c+1)*t.originalFrames),c);
   }
   return {id:t.id,laneId:t.laneId||"primary",name:t.name,gain:t.gain,offset:t.offset,muted:t.muted,processed:t.processed||false,sourceDescription:t.sourceDescription||"",effects:t.effects||[],renderedEffects:t.renderedEffects||"",buffer,originalBuffer};
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
