import {useEffect,useRef} from "react";
export default function NeonSpectrum({analyser,active,recording=false}){
 const canvas=useRef(null);
 useEffect(()=>{
  const el=canvas.current,ctx=el.getContext("2d");
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width=1,height=116,frame=0,last=0,levels=[],peaks=[],stopped=false;
  const frequencies=new Uint8Array(analyser?.frequencyBinCount||1024);
  const resize=()=>{const ratio=Math.min(devicePixelRatio||1,2);width=el.clientWidth;el.width=Math.max(1,width*ratio);el.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);draw(performance.now(),true);};
  function draw(now,force=false){
   if(stopped)return;
   if(!force&&now-last<(reduced?180:32)){frame=requestAnimationFrame(draw);return;}
   const elapsed=Math.min(100,(now-last)||32);last=now;
   ctx.clearRect(0,0,width,height);
   ctx.fillStyle="#080e17";ctx.fillRect(0,0,width,height);
   ctx.strokeStyle="#5de9f109";ctx.lineWidth=1;
   for(let y=14;y<height;y+=22){ctx.beginPath();ctx.moveTo(0,y+.5);ctx.lineTo(width,y+.5);ctx.stroke();}
   for(let x=0;x<width;x+=44){ctx.beginPath();ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,height);ctx.stroke();}
   if(analyser&&active)analyser.getByteFrequencyData(frequencies);else frequencies.fill(0);
   const count=Math.max(20,Math.min(64,Math.floor(width/11))),gap=4,pad=10;
   const step=(width-pad*2)/count,bar=Math.max(2,step-gap),center=height/2;
   const gradient=ctx.createLinearGradient(0,0,width,0);gradient.addColorStop(0,"#58ffb3");gradient.addColorStop(.35,"#23e9ff");gradient.addColorStop(.7,"#ad6cff");gradient.addColorStop(1,"#ff48ce");
   let moving=false;
   for(let i=0;i<count;i++){
    const low=35*(16000/35)**(i/count),high=35*(16000/35)**((i+1)/count);
    const hzPerBin=(analyser?.context.sampleRate||48000)/(analyser?.fftSize||2048);
    const a=Math.min(frequencies.length-1,Math.floor(low/hzPerBin)),b=Math.min(frequencies.length,Math.max(a+1,Math.ceil(high/hzPerBin)));
    let energy=0;for(let bin=a;bin<b;bin++)energy=Math.max(energy,frequencies[bin]);
    const target=(energy/255)**1.25;
    levels[i]=(levels[i]||0)+(target-(levels[i]||0))*(target>(levels[i]||0)?.7:.22);
    peaks[i]=Math.max(levels[i],(peaks[i]||0)-elapsed*.00065);
    if(levels[i]>.008||peaks[i]>.008)moving=true;
    const amplitude=Math.max(1,levels[i]*46),x=pad+i*step;
    ctx.fillStyle=gradient;ctx.globalAlpha=.95;ctx.shadowColor=i<count*.55?"#25edff":"#cf54ff";ctx.shadowBlur=reduced?0:9;
    ctx.fillRect(x,center-amplitude,bar,amplitude);
    ctx.globalAlpha=.28;ctx.shadowBlur=0;ctx.fillRect(x,center+2,bar,amplitude*.62);
    if(peaks[i]>.02){ctx.globalAlpha=.8;ctx.fillStyle="#e5ffff";ctx.fillRect(x,center-Math.max(2,peaks[i]*46)-3,bar,1);}
   }
   ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.strokeStyle="#7bf7ee33";ctx.beginPath();ctx.moveTo(0,center+1);ctx.lineTo(width,center+1);ctx.stroke();
   if(!force&&(active||moving))frame=requestAnimationFrame(draw);
  }
  const observer=new ResizeObserver(resize);observer.observe(el);resize();frame=requestAnimationFrame(draw);
  return()=>{stopped=true;cancelAnimationFrame(frame);observer.disconnect();};
 },[analyser,active]);
 return <section className={"neon-spectrum "+(active?"neon-active":"")} aria-label="Espectro de audio en directo">
  <div className="spectrum-heading"><span><i/>ESPECTRO NEÓN</span><span>{active?(recording?"MICRÓFONO EN DIRECTO":"SINCRONIZADO CON EL AUDIO"):"EN ESPERA"}</span></div>
  <canvas ref={canvas} role="img" aria-label="Barras de frecuencia que suben y bajan con el audio real" data-testid="neon-spectrum"/>
  <div className="spectrum-scale"><span>GRAVES</span><span>MEDIOS</span><span>AGUDOS</span></div>
 </section>;
}
