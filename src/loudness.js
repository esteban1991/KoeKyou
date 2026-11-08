// Sonoridad BS.1770-4 en tiempo real: mismo filtro K y puertas que el motor (mastering.py).
function kWeighting(rate){
 let k=Math.tan(Math.PI*1681.974450955533/rate),q=0.7071752369554196;
 const vh=10**(3.999843853973347/20),vb=vh**0.4996667741545416;let a0=1+k/q+k*k;
 const shelf=[(vh+vb*k/q+k*k)/a0,2*(k*k-vh)/a0,(vh-vb*k/q+k*k)/a0,2*(k*k-1)/a0,(1-k/q+k*k)/a0];
 k=Math.tan(Math.PI*38.13547087602444/rate);q=0.5003270373238773;a0=1+k/q+k*k;
 const highpass=[1,-2,1,2*(k*k-1)/a0,(1-k/q+k*k)/a0];
 return [shelf,highpass];
}
const lufs=power=>power>0?-0.691+10*Math.log10(power):-Infinity;
export function createLoudnessMeter(rate){
 const stages=kWeighting(rate).map(coefficients=>({c:coefficients,z1:0,z2:0}));
 const step=Math.round(rate*0.1),blocks=[];let sum=0,count=0;
 const mean=n=>{const tail=blocks.slice(-n);return tail.length<n?0:tail.reduce((a,b)=>a+b,0)/n;};
 return {
  push(samples){
   for(let i=0;i<samples.length;i++){
    let x=samples[i];
    for(const s of stages){const [b0,b1,b2,a1,a2]=s.c,y=b0*x+s.z1;s.z1=b1*x-a1*y+s.z2;s.z2=b2*x-a2*y;x=y;}
    sum+=x*x;if(++count===step){blocks.push(sum/step);sum=0;count=0;}
   }
  },
  read(){
   // Bloques de 400 ms con solapamiento del 75 %, puerta absoluta -70 y relativa -10.
   const gating=[];for(let i=3;i<blocks.length;i++)gating.push((blocks[i]+blocks[i-1]+blocks[i-2]+blocks[i-3])/4);
   const absolute=gating.filter(p=>lufs(p)>-70);
   let integrated=-Infinity;
   if(absolute.length){const relative=lufs(absolute.reduce((a,b)=>a+b,0)/absolute.length)-10,gated=absolute.filter(p=>lufs(p)>relative);integrated=lufs(gated.reduce((a,b)=>a+b,0)/gated.length);}
   return {momentary:lufs(mean(4)),shortTerm:lufs(mean(30)),integrated};
  }
 };
}
