import {useEffect,useRef} from "react";
export default function LiveRecording({peaks,frames,rate,lufs,target}){
 const canvas=useRef(null);
 useEffect(()=>{
  const el=canvas.current,draw=()=>{
   const width=el.clientWidth,height=110,dpr=devicePixelRatio||1;
   el.width=width*dpr;el.height=height*dpr;const ctx=el.getContext("2d");ctx.scale(dpr,dpr);
   ctx.strokeStyle="#ffffff18";ctx.beginPath();ctx.moveTo(0,height/2);ctx.lineTo(width,height/2);ctx.stroke();
   const seconds=Math.max(15,frames/rate),count=seconds*rate/4096;
   ctx.strokeStyle="#f0a6ae";ctx.lineWidth=Math.max(1,width/count*.65);
   for(let i=0;i<peaks.length;i++){const x=i/count*width,h=Math.max(.6,peaks[i]*48);ctx.beginPath();ctx.moveTo(x,55-h);ctx.lineTo(x,55+h);ctx.stroke();}
   const x=Math.min(width,frames/rate/seconds*width);ctx.strokeStyle="#f4c17f";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,110);ctx.stroke();
  };const observer=new ResizeObserver(draw);observer.observe(el);draw();return()=>observer.disconnect();
 },[peaks,frames,rate]);
 const peak=peaks.at(-1)||0,db=peak>0?Math.max(-60,20*Math.log10(peak)):-60;
 const short=lufs?.shortTerm,scale=v=>Math.min(100,Math.max(0,(v+60)/60*100))+"%";
 const show=v=>Number.isFinite(v)?v.toFixed(1).replace(".",","):"—";
 return <div className="live-recording"><div><span className="live-dot"/>GRABANDO · PCM SIN COMPRESIÓN <span>{(frames/rate).toFixed(1)} s</span></div><canvas ref={canvas} aria-label="Forma de onda en directo: muestra voz, pausas y silencios"/>
  <div className="live-meters">
   <div><div className="meter-label"><span>PICO</span><output>{db.toFixed(0)} dBFS</output></div><div className="input-meter"><span style={{width:(db+60)/60*100+"%",background:peak>.95?"#ef7373":"#a9d6bc"}}/></div></div>
   <div data-testid="live-lufs"><div className="meter-label"><span>SONORIDAD (3 s)</span><output>{show(short)} LUFS</output></div><div className="input-meter lufs-meter"><span style={{width:Number.isFinite(short)?scale(short):"0%"}}/>{Number.isFinite(target)&&<em title={"Objetivo "+target+" LUFS"} style={{left:scale(target)}}/>}</div></div>
  </div>
  <p>Nivel: {db.toFixed(0)} dBFS · {peak>.95?"Entrada muy alta: baja la ganancia del micrófono.":peak<.01?"Silencio o señal baja":"Recibiendo voz"} · Momentánea {show(lufs?.momentary)} · Integrada {show(lufs?.integrated)} LUFS{Number.isFinite(target)?" (la mezcla final se lleva a "+target+")":""} · Copia recuperable cada 5 s.</p></div>;
}
