import {useEffect,useRef,useState} from "react";
// Agrupa los segmentos por pista (laneId): los de una misma pista comparten fila.
function packRows(clips){
 const groups=new Map();
 for(const clip of clips){const lane=clip.laneId||"primary";if(!groups.has(lane))groups.set(lane,[]);groups.get(lane).push(clip);}
 return [...groups.values()];
}
// Geometría de la línea de tiempo y sus gestos: mover el cursor, arrastrar segmentos y auto-desplazamiento.
export function useTimeline({tracks,liveTake,zoom,playback,locked,reveal,setReveal,onCursor,onPick,onMove}){
 const viewport=useRef(null),scrub=useRef(null),drag=useRef(null);
 const [dragPreview,setDragPreview]=useState(null);
 const offsetOf=t=>dragPreview?.id===t.id?dragPreview.offset:t.offset;
 const duration=Math.max(0,...tracks.map(t=>offsetOf(t)+t.buffer.duration));
 const rows=packRows([...tracks.filter(t=>t.id!==liveTake?.id).map(t=>({id:t.id,laneId:t.laneId||"primary",track:t,offset:t.offset,duration:t.buffer.duration})),...(liveTake?[liveTake]:[])]);
 const span=Math.max(10,Math.ceil((Math.max(duration,liveTake?liveTake.offset+liveTake.duration:0)+2)/5)*5);
 const pct=seconds=>(seconds/span*100)+"%";
 const width=Math.min(30000,Math.max(800,span*zoom));
 const edgeScroll=e=>{const v=viewport.current,box=v.getBoundingClientRect();if(e.clientX>box.right-35)v.scrollLeft+=18;if(e.clientX<box.left+35)v.scrollLeft-=18;};
 // Coloca el cursor donde se hace clic y permite arrastrarlo; el próximo segmento empieza ahí.
 const timeAt=e=>{const box=(viewport.current.querySelector(".timeline-lane")||e.currentTarget).getBoundingClientRect();return Math.round(Math.max(0,Math.min(900,(e.clientX-box.left)/box.width*span))*100)/100;};
 function seek(e){
  if(locked)return;
  e.preventDefault();e.stopPropagation();
  scrub.current={wasPlaying:playback.isActive()};playback.stop();
  e.currentTarget.setPointerCapture(e.pointerId);
  playback.setPlayTime(timeAt(e));onCursor();
 }
 function scrubMove(e){if(!scrub.current)return;edgeScroll(e);playback.setPlayTime(timeAt(e));}
 function scrubEnd(e){
  const s=scrub.current;if(!s)return;scrub.current=null;
  // Si sonaba, sigue desde el nuevo punto al soltar.
  if(s.wasPlaying)playback.resumeAt(timeAt(e));
 }
 const scrubbing={onPointerMove:scrubMove,onPointerUp:scrubEnd,onPointerCancel:scrubEnd};
 function beginMove(e,t){
  if(locked)return;e.preventDefault();onPick(t);
  e.currentTarget.setPointerCapture(e.pointerId);
  const lane=e.currentTarget.closest(".timeline-lane");
  drag.current={id:t.id,start:e.clientX,offset:t.offset,scroll:viewport.current.scrollLeft,scale:lane.clientWidth/span};
  setDragPreview({id:t.id,offset:t.offset});
 }
 function moveClip(e){
  const d=drag.current;if(!d)return;
  if(!d.stopped&&Math.abs(e.clientX-d.start)>2){playback.stop();d.stopped=true;}
  edgeScroll(e);
  const offset=Math.round(Math.max(0,Math.min(900,(e.clientX-d.start+viewport.current.scrollLeft-d.scroll)/d.scale+d.offset))*100)/100;
  d.latest=offset;setDragPreview({id:d.id,offset});
 }
 function endMove(){
  const d=drag.current;if(!d)return;drag.current=null;
  if(d.latest!==undefined&&d.latest!==d.offset)onMove(d.id,d.latest);
  setDragPreview(null);
 }
 const clipDrag={onPointerMove:moveClip,onPointerUp:endMove,onPointerCancel:endMove};
 useEffect(()=>{
  const v=viewport.current;if(reveal===null||!v)return;
  const x=reveal/span*v.scrollWidth;
  if(x<v.scrollLeft+40||x>v.scrollLeft+v.clientWidth-80)v.scrollTo({left:Math.max(0,x-80),behavior:"smooth"});
  v.scrollIntoView({block:"nearest",behavior:"smooth"});setReveal(null);
 },[reveal,span]);
 useEffect(()=>{
  const v=viewport.current;if(!liveTake||!v)return;
  const x=(liveTake.offset+liveTake.duration)/span*v.scrollWidth;
  if(x>v.scrollLeft+v.clientWidth-60)v.scrollLeft=x-v.clientWidth+160;
 },[liveTake?.duration,span]);
 return {viewport,rows,span,pct,width,duration,dragPreview,offsetOf,seek,scrubbing,beginMove,clipDrag};
}
