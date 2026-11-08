import {useCallback,useEffect,useRef,useState,useMemo} from "react";
import {AudioLines,SlidersHorizontal,RotateCcw,ChevronLeft,ChevronRight,X,Sparkles} from "lucide-react";
import {masterDefaults} from "./fx";
import AudioEditor from "./AudioEditor";
import "./editor.css";
const initial={depth:4,clarity:3,compression:55,cleanup:25,deess:0,denoise:0,leveler:0,pitch:0,roomtail:0,breath:0};
const presets={
 podcast:{name:"Podcast",description:"Voz cálida y cercana.",settings:{depth:4,clarity:3,compression:55,cleanup:25}},
 announcer:{name:"Locutor",description:"Más cuerpo, presencia y nivelado.",settings:{depth:6,clarity:4,compression:70,cleanup:30,deess:40,leveler:65}},
 room:{name:"Habitación cerrada",description:"Reflejos cortos y discretos.",settings:{depth:3,clarity:2,compression:40,cleanup:20}},
 outdoor:{name:"Aire libre",description:"Voz seca y reducción espectral moderada.",settings:{depth:1,clarity:5,compression:45,cleanup:65,denoise:25}},
 cathedral:{name:"Catedral",description:"Reverberación amplia con 4 segundos de cola.",settings:{depth:3,clarity:3,compression:35,cleanup:10}}
};
const microphones={dynamic:"Dinámico",condenser:"Condensador",usb:"USB",lavalier:"Solapa",laptop:"Portátil",generic:"Genérico"};
const loudnessTargets={"-14":"-14 LUFS · Spotify / YouTube","-16":"-16 LUFS · Podcast","-19":"-19 LUFS · Podcast mono"};
// Solo los valores válidos de un proyecto guardado; el resto vuelve al valor por defecto.
const pickMaster=s=>({mic:s?.mic in microphones?s.mic:masterDefaults.mic,loudness:s?.loudness in loudnessTargets?s.loudness:masterDefaults.loudness,ai_denoise:Math.max(0,Math.min(100,Number(s?.ai_denoise)||0))});
const fmt=(v,unit)=>v==null?"—":v.toFixed(1).replace(".",",")+" "+unit;
const controls=[
 ["depth","Profundidad","Cuerpo y calidez",0,10,"dB"],["clarity","Claridad","Presencia",0,8,"dB"],
 ["compression","Compresión","Empareja la voz",0,100,"%"],["cleanup","Limpieza","Puerta de ruido",0,100,"%"],
 ["deess","De-esser","Suaviza las eses",0,100,"%"],["denoise","Ruido continuo","Reducción espectral sin IA",0,100,"%"],
 ["leveler","Nivelado automático","Ajusta el volumen medio",0,100,"%"],["pitch","Tono","Grave o agudo",-6,6,"st"],
 ["roomtail","Colas de sala","Atenúa colas suaves en pausas",0,100,"%"],
 ["breath","Respiraciones","Baja las tomas de aire entre frases",0,100,"%"]
];
export default function App(){
 const editor=useRef(null),previousSelection=useRef({id:null,hasEffects:false}),lastAi=useRef(60);
 const [master,setMaster]=useState(masterDefaults);
 const setMasterValue=(key,value)=>setMaster(m=>({...m,[key]:value}));
 const [target,setTarget]=useState(null),[activeId,setActiveId]=useState(null),[showEffects,setShowEffects]=useState(false),[online,setOnline]=useState(false),[message,setMessage]=useState("");
 const onSelection=useCallback(value=>{
  const id=value?.id||null,hasEffects=!!value?.effects?.length,previous=previousSelection.current;
  setTarget(value);
  if(id!==previous.id)setShowEffects(hasEffects);
  else if(previous.hasEffects&&!hasEffects)setShowEffects(false);
  else if(!previous.hasEffects&&hasEffects)setShowEffects(true);
  previousSelection.current={id,hasEffects};
 },[]);
 const open=showEffects&&!!target;
 const layers=target?.effects||[];
 const active=layers.find(layer=>layer.id===activeId)||layers.at(-1);
 const settings=useMemo(()=>({...initial,...active?.settings}),[active?.settings]),preset=active?.preset||"podcast";
 useEffect(()=>{let alive=true;const check=async()=>{try{const r=await fetch("http://127.0.0.1:8000/health",{signal:AbortSignal.timeout(2000)});if(alive)setOnline(r.ok);}catch{if(alive)setOnline(false);}};check();const timer=setInterval(check,4000);return()=>{alive=false;clearInterval(timer);};},[]);
 function updateLayers(next){setMessage("");editor.current?.updateEffects(next);}
 function addPreset(key){
  if(!target)return;
  const existing=layers.find(layer=>layer.preset===key);
  if(existing){setActiveId(existing.id);return;}
  const layer={id:crypto.randomUUID(),name:presets[key].name,preset:key,enabled:false,settings:{...initial,...presets[key].settings}};
  updateLayers([...layers,layer]);setActiveId(layer.id);
 }
 function control([key,label,description,min,max,unit]){
  return <div className="control" key={key}><div className="control-label"><div><label htmlFor={key}>{label}</label><small>{description}</small></div><output htmlFor={key}>{settings[key]}<span>{unit}</span></output></div><input id={key} aria-label={label} disabled={!active} type="range" min={min} max={max} step="1" value={settings[key]} onChange={e=>updateLayers(layers.map(layer=>layer.id===active.id?{...layer,settings:{...settings,[key]:Number(e.target.value)}}:layer))} style={{"--fill":((settings[key]-min)/(max-min)*100)+"%","--accent":"#b5a1f2"}}/></div>;
 }
 return <div className="app-shell">
  <aside className={"sidebar fx-sidebar "+(open?"":"fx-collapsed")}>
   <div className="brand"><span className="brand-icon"><AudioLines size={22}/></span>{open&&<>VoiceMaster<span className="pro">PRO</span></>}</div>
   <button className="toggle-effects" disabled={!target} aria-label={open?"Ocultar filtros":"Mostrar filtros"} onClick={()=>setShowEffects(v=>!v)}>{open?<ChevronLeft size={16}/>:<ChevronRight size={16}/>}</button>
   {open&&<>
    <div className="fx-target"><span className="eyebrow">EFECTOS AUTOMÁTICOS</span><h2>{target?target.name:"Selecciona una pista"}</h2><p>Se escuchan y se exportan en esta misma pista.</p></div>
    <div className="fx-scroll">
     <div className="panel-heading"><span><SlidersHorizontal size={16}/>Añadir efecto</span><button aria-label="Quitar todos los efectos" disabled={!layers.length} onClick={()=>updateLayers([])}><RotateCcw size={14}/></button></div>
     <div className="preset-options">{Object.entries(presets).map(([key,value])=><button key={key} disabled={!target} aria-pressed={layers.some(l=>l.preset===key&&l.enabled!==false)} className={layers.some(l=>l.preset===key&&l.enabled!==false)?"chosen":""} onClick={()=>addPreset(key)}>{value.name}</button>)}</div>
     <div className="effect-layers">{layers.map(layer=><div className={layer.id===active?.id?"active-layer":""} key={layer.id}><input aria-label={"Activar efecto "+layer.name} type="checkbox" checked={layer.enabled!==false} onChange={e=>updateLayers(layers.map(l=>l.id===layer.id?{...l,enabled:e.target.checked}:l))}/><button onClick={()=>setActiveId(layer.id)}>{layer.name}</button><button aria-label={"Quitar efecto "+layer.name} onClick={()=>updateLayers(layers.filter(l=>l.id!==layer.id))}><X size={13}/></button></div>)}</div>
     <p className="preset-description">{active?presets[preset].description:"Activa uno o varios efectos. La × quita cada efecto y restaura su contribución desde el original."}</p>
     {active&&<><div className="editing-layer">AJUSTANDO · {active.name}</div><button className={"activate-effect "+(active.enabled!==false?"is-active":"")} onClick={()=>updateLayers(layers.map(l=>l.id===active.id?{...l,enabled:l.enabled===false}:l))}>{active.enabled===false?"Activar efecto":"Desactivar efecto"}</button><p className="effect-mode-note">{active.enabled===false?"Agregado, todavía no afecta al audio. Ajusta y activa cuando quieras.":"Activo: los controles actualizan esta pista automáticamente."}</p>{controls.slice(0,4).map(control)}<details className="advanced-fx"><summary>Más herramientas de voz</summary><div>{controls.slice(4).map(control)}</div></details></>}
    </div>
    <div className="fx-apply"><p role="status" className={target?.fxError?"error":"success-note"} data-testid="fx-status">{target?.fxError||(layers.length&&!layers.some(l=>l.enabled!==false)?"Efectos agregados · sin activar":target?.fxStatus||"Audio original · sin efectos")}</p>{target?.fxError&&<button onClick={()=>editor.current?.retryEffects()}>Reintentar efectos</button>}<small>Actualización automática. No necesitas aplicar ni crear otro audio.</small>{message&&<p>{message}</p>}</div>
   </>}
  </aside>
  <main><header><span>VoiceMaster Pro <span className="muted">/</span> Estudio de voz</span><span className={"status "+(online?"ready":"")}><i/>{online?"Motor conectado":"Esperando al motor"}</span></header>
   <section className="workspace"><div className="eyebrow"><span/> ESTUDIO PERSONAL DE AUDIO</div><div className="title-row"><div><h1>Tu voz. En su mejor versión.</h1><p>Graba, mueve, corta y dale tu sonido.</p></div></div>
    <section className="panel master-panel" aria-label="Ajustes maestros">
     <div className="master-heading"><span className="eyebrow"><Sparkles size={12}/> AJUSTES MAESTROS</span><small>Se aplican a cada pista con efectos activos. La sonoridad se fija al final de la cadena con pico verdadero de -1 dBTP.</small></div>
     <div className="master-grid">
      <label className="fx-select">Perfil de micrófono<select aria-label="Perfil de micrófono" value={master.mic} onChange={e=>setMasterValue("mic",e.target.value)}>{Object.entries(microphones).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label className="fx-select">Volumen objetivo<select aria-label="Volumen objetivo" value={master.loudness} onChange={e=>setMasterValue("loudness",e.target.value)}>{Object.entries(loudnessTargets).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <div className="ai-control">
       <div className="ai-row"><span>Limpieza IA</span><button type="button" role="switch" aria-checked={master.ai_denoise>0} aria-label="Limpieza IA" className={"switch"+(master.ai_denoise>0?" on":"")} onClick={()=>{if(master.ai_denoise>0){lastAi.current=master.ai_denoise;setMasterValue("ai_denoise",0);}else setMasterValue("ai_denoise",lastAi.current);}}><i/></button></div>
       <input type="range" aria-label="Intensidad de limpieza IA" disabled={!master.ai_denoise} min="10" max="100" step="5" value={master.ai_denoise||lastAi.current} onChange={e=>setMasterValue("ai_denoise",Number(e.target.value))} style={{"--fill":(((master.ai_denoise||lastAi.current)-10)/90*100)+"%","--accent":"#b5a1f2"}}/>
       <small>{master.ai_denoise?master.ai_denoise+"% · DeepFilterNet quita ruido y eco":"Desactivada"}</small>
      </div>
      <div className="master-result" data-testid="master-result"><span>PISTA SELECCIONADA</span>{target?.stats?<><strong>{fmt(target.stats.output,"LUFS")}</strong><small>Pico verdadero {fmt(target.stats.peak,"dBTP")} · original {fmt(target.stats.input,"LUFS")}</small>{target.stats.output!=null&&Math.abs(target.stats.output-Number(master.loudness))>1&&<small className="master-warning">No llega a {master.loudness} LUFS sin superar -1 dBTP: la señal tiene picos muy altos respecto a su volumen medio.</small>}</>:<small>{target?"Activa un efecto para medir el resultado.":"Selecciona una pista."}</small>}</div>
     </div>
    </section>
    <AudioEditor editorRef={editor} onTrackSelection={onSelection} settings={master} preset={preset} onRestoreSettings={s=>setMaster(pickMaster(s))} onShowEffects={()=>setShowEffects(true)}/>
    <footer><span>VOICEMASTER PRO</span><span>Audio local · WAV 24 bits · Audacity / DaVinci Resolve</span></footer>
   </section>
  </main>
 </div>;
}
