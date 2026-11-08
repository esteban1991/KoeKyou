import {useEffect,useRef} from "react";
import {RATE} from "../audio";
// Un único AudioContext compartido por grabación y reproducción; los cortes sin él usan uno offline.
export function useAudioEngine(){
 const context=useRef(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;context.current?.close();context.current=null;};},[]);
 async function audioContext(){if(!context.current)context.current=new AudioContext({sampleRate:RATE});await context.current.resume();return context.current;}
 const editingContext=()=>context.current||new OfflineAudioContext(2,1,RATE);
 const sampleRate=()=>context.current?.sampleRate||RATE;
 return {context,mounted,audioContext,editingContext,sampleRate};
}
