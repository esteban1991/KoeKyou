class PCMRecorder extends AudioWorkletProcessor {
 constructor(){super();this.chunk=new Float32Array(4096);this.used=0;this.port.onmessage=e=>{if(e.data==="flush"){if(this.used)this.port.postMessage(this.chunk.slice(0,this.used));this.used=0;this.port.postMessage("flushed");}};}
 process(inputs){
  const channels=inputs[0];
  if(channels?.length)for(let i=0;i<channels[0].length;i++){
   let sample=0;for(const channel of channels)sample+=channel[i]/channels.length;
   this.chunk[this.used++]=sample;
   if(this.used===this.chunk.length){this.port.postMessage(this.chunk,[this.chunk.buffer]);this.chunk=new Float32Array(4096);this.used=0;}
  }
  return true;
 }
}
registerProcessor("pcm-recorder",PCMRecorder);
