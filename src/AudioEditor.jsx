import NeonSpectrum from "./NeonSpectrum";
import {fxSignature,masterDefaults} from "./fx";
import LiveRecording from "./LiveRecording";
import {useProjectStore} from "./projectStore";
import {useAudioEngine} from "./hooks/useAudioEngine";
import {useAudioPlayback} from "./hooks/useAudioPlayback";
import {useAudioRecording} from "./hooks/useAudioRecording";
import {useAudioEditing,MAX_SEGMENTS} from "./hooks/useAudioEditing";
import {useTrackEffects,effectsPending,hasActiveLayers} from "./hooks/useTrackEffects";
import {useTimeline} from "./hooks/useTimeline";
import {useEffect,useRef,useState,useImperativeHandle} from "react";
import {Mic,Square,Plus,Scissors,Trash2,Undo2,Play,Download,Volume2,VolumeX,ChevronDown,Save,Copy,FolderOpen,SlidersHorizontal,X,GripHorizontal,AudioLines} from "lucide-react";
import {mixTracks,download} from "./audio";

// Términos de la interfaz: Proyecto > Pista (fila de la línea de tiempo) > Segmento (bloque de audio) > Capa (efecto).
// En el código un segmento es un elemento de `tracks` y su pista es `laneId`.
const clock=s=>{const n=Math.max(0,s);return Math.floor(n/60)+":"+(n%60).toFixed(2).padStart(5,"0");};
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
 const engine=useAudioEngine();
 const [tracks,setTracks]=useState([]),latestTracks=useRef(tracks);latestTracks.current=tracks;
 const [selected,setSelected]=useState(null),[error,setError]=useState(""),[working,setWorking]=useState(false);
 const [mode,setMode]=useState(null),[zoom,setZoom]=useState(64),[reveal,setReveal]=useState(null);
 const input=useRef(null),replacePicker=useRef(null),menu=useRef(null);
 const fxPending=effectsPending(tracks,settings);
 const playback=useAudioPlayback({engine,latestTracks,selected,onError:setError});
 const editing=useAudioEditing({engine,tracks,setTracks,latestTracks,selected,setSelected,playback,setError,setWorking,setReveal,fxPending});
 const recorder=useAudioRecording({engine,onError:setError,
  onDraft:draft=>setTracks(current=>current.some(t=>t.id===draft.id)?current.map(t=>t.id===draft.id?draft:t):[...current,draft]),
  onComplete:editing.commitRecording});
 const effects=useTrackEffects({engine,tracks,setTracks,latestTracks,settings,selected,playback,remember:editing.remember});
 const store=useProjectStore({tracks,setTracks,settings,preset,onSettings:onRestoreSettings,onReset:()=>{playback.stop();playback.setPlayTime(0);setSelected(null);editing.setHistory([]);}});
 const {recording,liveTake}=recorder,{playing,playTime,playScope}=playback,{track,selection,setSelection}=editing;
 const locked=disabled||working||recorder.busy||recording||!store.ready||store.switching;
 const timeline=useTimeline({tracks,liveTake,zoom,playback,locked,reveal,setReveal,onCursor:()=>editing.setPlacement("cursor"),onPick:editing.choose,onMove:editing.moveTo});
 const {pct,duration}=timeline;
 function closeMenu(){if(menu.current)menu.current.open=false;}
 async function startRecording(){
  setError("");playback.stop();
  if(tracks.length>=MAX_SEGMENTS){setError("El máximo es "+MAX_SEGMENTS+" segmentos.");return;}
  if(await recorder.start({offset:editing.insertionPoint,laneId:editing.targetLane(),original:tracks}))setReveal(editing.insertionPoint);
 }
 async function exportMix(){
  setWorking(true);setError("");
  try{
   if(fxPending)throw new Error("Espera a que terminen de actualizarse los efectos.");
   download(mixTracks(engine.editingContext(),tracks),"koe-kyo-mezcla.wav");
  }catch(e){setError(e.message);}finally{setWorking(false);}
 }
 useImperativeHandle(editorRef,()=>({updateEffects:effects.updateEffects,retryEffects:effects.retry}));
 useEffect(()=>{
  const t=tracks.find(item=>item.id===selected);
  // Siempre hay un segmento seleccionado: sus controles se muestran bajo la línea de tiempo.
  if(!t&&tracks.length&&!recording){editing.choose(tracks.at(-1));return;}
  const state=t&&effects.fxStates[t.id];
  onTrackSelection(t?{id:t.id,name:t.name,effects:t.effects||[],fxStatus:effects.describe(t),fxError:state?.error||"",stats:state?.stats||null}:null);
 },[tracks,selected,effects.fxStates,onTrackSelection,recording]);
 return <section className="panel multitrack" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!locked)editing.importFiles(Array.from(e.dataTransfer.files));}}>
  <div className="project-bar">
   <div><input aria-label="Nombre del proyecto" maxLength="150" disabled={locked} value={store.project?.name||""} placeholder="Cargando proyecto…" onChange={e=>store.rename(e.target.value)}/><small role="status" data-testid="save-status">{store.status}</small></div>
   <select aria-label="Abrir proyecto" disabled={locked} value={store.project?.id||""} onChange={e=>store.open(e.target.value)}><option value="" disabled>Mis proyectos</option>{store.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
   <details ref={menu} className="studio-menu"><summary><Plus size={16}/> Menú del estudio <ChevronDown size={14}/></summary><div className="menu-popover">
    <button disabled={locked} onClick={()=>{closeMenu();setMode("record");}}><Mic size={16}/><span>Grabar<small>Abrir el micrófono</small></span></button>
    <button disabled={locked} onClick={()=>{closeMenu();setMode("import");}}><FolderOpen size={16}/><span>Importar archivo<small>Añadir WAV o MP3</small></span></button>
    <button disabled={locked} onClick={()=>{closeMenu();editing.setDestination("new");setMode("import");}}><Plus size={16}/><span>Crear otra pista<small>Voz y música en pistas separadas</small></span></button>
    <button disabled={locked||!selected} onClick={()=>{closeMenu();onShowEffects();}}><SlidersHorizontal size={16}/><span>Añadir capa de efecto<small>Podcast y ambientes</small></span></button>
    <button disabled={locked||!tracks.length} onClick={()=>{closeMenu();setMode("export");}}><Download size={16}/><span>Exportar<small>Audacity / DaVinci Resolve</small></span></button>
    <hr/><button disabled={locked} onClick={()=>{closeMenu();store.save();}}><Save size={16}/>Guardar proyecto</button>
    <button disabled={locked} onClick={()=>{closeMenu();setMode(null);store.create();}}><Plus size={16}/>Nuevo proyecto</button>
    <button disabled={locked} onClick={()=>{closeMenu();store.duplicate();}}><Copy size={16}/>Duplicar proyecto</button>
   </div></details>
  </div>
  {store.error&&<div role="alert" className="error">{store.error} {!store.ready&&<button onClick={()=>location.reload()}>Reintentar</button>}</div>}
  {mode&&<div className="context-panel"><button aria-label="Cerrar panel" className="close-panel" disabled={recording} onClick={()=>setMode(null)}><X size={15}/></button>
   {mode==="record"&&<><h2>Graba un segmento nuevo</h2><p>El segmento aparece a continuación del audio de la pista. Haz clic en la regla o en un hueco de la línea de tiempo para empezarlo en otro punto. Máximo 10 minutos por grabación.</p><button disabled={disabled||working||recorder.busy||!store.ready||store.switching} className={recording?"record recording":"record"} onClick={recording?recorder.stop:startRecording}>{recording?<Square size={15}/>:<Mic size={15}/>} {recording?"Detener · "+clock(recorder.seconds):"Grabar voz"}</button></>}
   {recording&&<LiveRecording peaks={recorder.capture.peaks} frames={recorder.capture.frames} lufs={recorder.capture.lufs} target={Number(settings.loudness)} rate={engine.sampleRate()}/>}
   {mode==="import"&&<><h2>Importa audio</h2><p>Arrastra archivos WAV o MP3 aquí, o selecciónalos desde tu equipo. Cada archivo se convierte en un segmento.</p><button disabled={locked} onClick={()=>input.current.click()}><Plus size={15}/>Añadir archivos</button></>}
   {mode==="export"&&<><h2>Continúa en tu editor favorito</h2><p>WAV de 24 bits y 48 kHz para importar en Audacity o DaVinci Resolve. Exporta la mezcla del proyecto o cada segmento desde su panel.</p><button disabled={locked||!tracks.length} onClick={()=>exportMix()}><Download size={15}/>Exportar mezcla WAV</button></>}
  </div>}
  <div className="editor-toolbar compact-toolbar">
   <button disabled={locked} onClick={()=>{menu.current.open=true;menu.current.scrollIntoView({block:"nearest"});}}><Plus size={15}/>Añadir audio</button>
   <button disabled={locked||fxPending||tracks.filter(t=>!t.muted).length<2} onClick={editing.combine}><AudioLines size={15}/>Combinar en uno</button>
   <button disabled={locked||!tracks.length} onClick={playback.toggle}>{playing?<Square size={15}/>:<Play size={15}/>} {playing?"Detener":playScope==="all"?"Escuchar mezcla":playScope==="lane"?"Reproducir pista":"Reproducir segmento"}</button>
   <button disabled={locked||!editing.history.length} onClick={editing.undo}><Undo2 size={15}/>Deshacer</button>
   <label className="loop-control" title="Repite la reproducción; no modifica ni alarga el archivo exportado"><input type="checkbox" aria-label="Loop" disabled={locked||!tracks.length} checked={playback.loopEnabled} onChange={e=>playback.changeOptions({loop:e.target.checked})}/>Loop</label>
   <label className="placement">Reproducir<select aria-label="Alcance de reproducción" disabled={locked||!tracks.length} value={playScope} onChange={e=>playback.changeOptions({scope:e.target.value})}><option value="all">Todo el proyecto</option><option value="clip" disabled={!selected}>Segmento seleccionado</option><option value="lane" disabled={!selected}>Pista del segmento seleccionado</option></select></label>
   {playScope!=="all"&&track&&<span className="loop-target" data-testid="loop-target">{playScope==="clip"?"Segmento: ":"Pista de: "}{track.name}</span>}
   {playing&&playback.loopEnabled&&<span className="loop-cycle" data-testid="loop-cycle">Vuelta {playback.loopCycle+1}</span>}
   <label className="placement">Destino<select aria-label="Pista de destino" disabled={locked} value={editing.destination} onChange={e=>editing.setDestination(e.target.value)}><option value="current">Pista actual</option><option value="new">Nueva pista</option></select></label>
   <label className="placement">Añadir audio<select aria-label="Posición del audio nuevo" disabled={locked} value={editing.placement} onChange={e=>editing.setPlacement(e.target.value)}><option value="end">Al final</option><option value="cursor">En el cursor</option><option value="overlap">Superponer</option></select></label>
   <label className="placement">Zoom<select aria-label="Zoom de la línea de tiempo" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value="32">32 px/s</option><option value="64">64 px/s</option><option value="128">128 px/s</option></select></label>
   <span className="track-count">{timeline.rows.length} pistas · {tracks.length} segmentos</span>
  </div>
  <input hidden ref={replacePicker} type="file" accept=".wav,.mp3" onChange={e=>{editing.replaceOriginal(e.target.files[0]);e.target.value="";}}/>
  <input hidden multiple type="file" accept=".wav,.mp3" ref={input} onChange={e=>{editing.importFiles(Array.from(e.target.files));e.target.value="";}}/>
  {!tracks.length&&<div className="empty-editor"><Plus size={26}/><h2>Un espacio para tu próxima idea.</h2><p>Abre el menú superior para grabar o importar audio.</p></div>}
  {track&&<div className="edit-menu-bar"><span>SEGMENTO SELECCIONADO · {track.name}</span><button className="remove-selected" disabled={locked} onClick={()=>editing.remove(track.id)}><Trash2 size={14}/>Eliminar segmento</button><details className="edit-actions"><summary><Scissors size={14}/>Editar segmento<ChevronDown size={14}/></summary><div className="selection-tools"><label>Inicio (s)<input type="number" disabled={locked} min="0" max={track.buffer.duration} step="0.01" value={selection[0]} onChange={e=>setSelection([Math.max(0,Math.min(selection[1],Number(e.target.value)||0)),selection[1]])}/></label><label>Fin (s)<input type="number" disabled={locked} min={selection[0]} max={track.buffer.duration} step="0.01" value={selection[1]} onChange={e=>setSelection([selection[0],Math.max(selection[0],Math.min(track.buffer.duration,Number(e.target.value)||0))])}/></label><button disabled={locked} onClick={()=>editing.edit("trim")}><Scissors size={14}/>Conservar selección</button><button disabled={locked} onClick={()=>editing.edit("delete")}><Trash2 size={14}/>Borrar selección</button><button disabled={locked} onClick={()=>editing.edit("split")}>Dividir en Inicio</button>
 <button disabled={locked} onClick={()=>editing.edit("extract")}>Separar selección</button>
 <button disabled={locked} onClick={()=>editing.patch(track.id,{offset:playTime})}>Mover al cursor</button>
 <button disabled={locked} onClick={()=>replacePicker.current.click()}>Restaurar desde archivo original</button>
 <button disabled={locked||!(track.effects||[]).length} onClick={()=>effects.updateEffects([])}>Quitar todas las capas de este segmento</button>
 <label>Velocidad<select aria-label="Velocidad del segmento" disabled={locked||fxPending} value={editing.tempo} onChange={e=>editing.setTempo(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(v=><option value={v} key={v}>{v}×</option>)}</select></label><button disabled={locked||fxPending||editing.tempo===1} onClick={editing.applyTempo}>Cambiar velocidad conservando tono</button></div></details></div>}
  {(!!tracks.length||recording)&&<NeonSpectrum analyser={recording?recorder.micAnalyser.current:playback.outputAnalyser.current} active={recording||playing} recording={recording}/>}
  {!!tracks.length&&<div className="transport">
   <div><strong>REPRODUCCIÓN</strong><output data-testid="playback-time">{clock(playTime)} / {clock(duration)}</output></div>
   <input aria-label="Posición de reproducción" disabled={locked} type="range" min="0" max={duration||1} step="0.01" value={Math.min(playTime,duration)} {...playback.slider} style={{"--fill":(duration?playTime/duration*100:0)+"%","--accent":"#e4b47d"}}/>
  </div>}
  <div className="timeline-viewport" ref={timeline.viewport}><div className="timeline-content" style={{width:timeline.width}}>
  <div className="time-ruler timeline-ruler" title="Haz clic o arrastra para mover el cursor" onPointerDown={timeline.seek} {...timeline.scrubbing}>{Array.from({length:11},(_,i)=><span key={i}>{clock(timeline.span*i/10)}</span>)}{(mode==="record"||mode==="import")&&!recording&&!!tracks.length&&<i className="insert-marker" style={{left:pct(editing.insertionPoint)}}><span>Nuevo segmento</span></i>}<span aria-hidden="true" className="playhead grab" style={{left:pct(Math.min(playTime,timeline.span))}}/></div>
  <div className="track-list">{timeline.rows.map((row,r)=><div className="timeline-lane" key={r} data-lane={row[0]?.laneId||"primary"} onPointerDown={e=>{if(e.target===e.currentTarget)timeline.seek(e);}} {...timeline.scrubbing}>
   <span className="lane-number">Pista {r+1}</span>{row.map(c=>c.ghost?<article key={c.id} className="clip recording-clip" style={{left:pct(c.offset),width:pct(c.duration)}}><span><Mic size={12}/>Grabando · {clock(c.duration)}</span></article>
   :<article key={c.id} data-name={c.track.name} data-offset={c.track.offset} className={"clip audio-track"+(selected===c.id?" selected":"")+(c.track.muted?" muted":"")+(timeline.dragPreview?.id===c.id?" dragging":"")} style={{left:pct(timeline.offsetOf(c.track)),width:pct(c.duration)}}>
    <button className="clip-handle" aria-label={"Mover segmento "+c.track.name} disabled={locked} onPointerDown={e=>timeline.beginMove(e,c.track)} {...timeline.clipDrag}><GripHorizontal size={13}/><span>{c.track.name}</span></button>
    <Waveform track={c.track} disabled={locked} selection={selected===c.id?selection:null} onSelect={range=>{setSelected(c.id);setSelection(range);}}/>
   </article>)}
   <span aria-hidden="true" className="playhead grab" data-testid="playhead" title="Arrastra para mover el cursor" style={{left:pct(Math.min(playTime,timeline.span))}} onPointerDown={timeline.seek} {...timeline.scrubbing}/>
  </div>)}</div></div></div>
  {track&&(t=>{const i=tracks.indexOf(t),layers=t.effects||[];return <div className="clip-inspector" key={t.id}>
   <div className="track-heading"><button className="track-name" disabled={locked} onClick={()=>editing.choose(t)}>{String(i+1).padStart(2,"0")} · {t.name}</button>{hasActiveLayers(t)&&<span className="applied-badge">{t.renderedEffects===fxSignature(t.effects,settings)?"FX activos":"Actualizando FX…"}</span>}{t.sourceDescription&&<span className="source-description">{t.sourceDescription}</span>}<span>{clock(t.buffer.duration)}</span><button aria-label={t.muted?"Activar segmento":"Silenciar segmento"} disabled={locked} onClick={()=>editing.patch(t.id,{muted:!t.muted})}>{t.muted?<VolumeX size={15}/>:<Volume2 size={15}/>}</button><button aria-label="Eliminar este segmento" disabled={locked} onClick={()=>editing.remove(t.id)}><Trash2 size={15}/></button></div>
   <div className="track-fields"><button disabled={locked||t.muted} className="solo-loop-button" onClick={()=>{setError("");playback.loopClip(t);}}><Play size={14}/>Reproducir este segmento en loop</button>{layers.length?<span className="track-effect-summary">{layers.filter(l=>l.enabled!==false).length} capas activas · {layers.length} en total</span>:<button disabled={locked} onClick={()=>{editing.choose(t);onShowEffects();}}>Mejorar voz</button>}<label>Posición (s)<input disabled={locked} type="number" min="0" max="900" step="0.01" value={t.offset} onChange={e=>editing.patch(t.id,{offset:Math.max(0,Math.min(900,Number(e.target.value)||0))})}/></label><label>Volumen (dB)<input disabled={locked} type="number" min="-60" max="12" value={t.gain} onChange={e=>editing.patch(t.id,{gain:Math.max(-60,Math.min(12,Number(e.target.value)||0))})}/></label><button disabled={locked||fxPending} onClick={()=>{try{download(mixTracks(engine.editingContext(),[{...t,offset:0,muted:false}]),t.name+".wav");}catch(e){setError(e.message);}}}><Download size={14}/>WAV del segmento</button></div>
  </div>;})(track)}

  {error&&<div role="alert" className="error">{error}</div>}
  {!!tracks.length&&<div className="editor-export"><button disabled={locked||fxPending} onClick={exportMix}><Download size={15}/>Exportar mezcla WAV</button><span className="control-note">{fxPending?"Actualizando efectos…":"Los WAV incluyen las capas de efecto activas."}</span></div>}

  <p className="control-note">Un proyecto tiene pistas (filas), cada pista tiene segmentos (bloques de audio) y cada segmento puede llevar capas de efecto. Los segmentos nuevos aparecen a continuación del audio; haz clic en la regla o en un hueco para empezar en otro punto. Arrastra la cabecera de un segmento para moverlo; arrastra sobre la onda para seleccionar. Los WAV de segmento comienzan en cero; la mezcla conserva sus posiciones. El proyecto se guarda automáticamente. Combinar une los segmentos activos e incorpora sus capas; Deshacer los separa durante esta sesión.</p>
 </section>;
}
