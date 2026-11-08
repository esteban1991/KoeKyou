import {useEffect,useState} from "react";
export default function Obake(){
 const [visible,setVisible]=useState(true),[hello,setHello]=useState(false);
 useEffect(()=>{if(!hello)return;const timer=setTimeout(()=>setHello(false),2600);return()=>clearTimeout(timer);},[hello]);
 if(!visible)return <button className="obake-restore" aria-label="Mostrar obake" title="Mostrar obake" onClick={()=>setVisible(true)}>☁</button>;
 return <div className={"obake-companion "+(hello?"obake-hello":"")}>
  <div className="obake-bubble" aria-live="polite">{hello?<><span lang="ja">こんにちは!</span><small>¡Tu voz tiene magia!</small></>:null}</div>
  <button className="obake-dismiss" aria-label="Ocultar obake" onClick={()=>setVisible(false)}>×</button>
  <button className="obake-character" aria-label="Saludar al obake de Koe-Kyō" title="¡Hola, soy tu obake!" onClick={()=>setHello(true)}>
   <svg viewBox="0 0 110 132" aria-hidden="true">
    <defs><linearGradient id="obake-body" x1="0" x2=".8" y1="0" y2="1"><stop stopColor="#f4ffff"/><stop offset=".55" stopColor="#e8dcff"/><stop offset="1" stopColor="#b1a3ed"/></linearGradient><radialGradient id="obake-halo"><stop stopColor="#46efee" stopOpacity=".2"/><stop offset="1" stopColor="#46efee" stopOpacity="0"/></radialGradient></defs>
    <ellipse cx="55" cy="117" rx="32" ry="8" fill="url(#obake-halo)" className="obake-shadow"/>
    <g className="obake-float">
     <path className="obake-spark" d="M18 32q-9 9-4 14t10-4q3-5-6-10" fill="#79f9e2" opacity=".8"/>
     <path className="obake-spark second" d="M94 66q-8 10-4 13t8-3q3-5-4-10" fill="#d395ff" opacity=".8"/>
     <path d="M26 71c-12-4-17 3-15 9 2 5 11 8 19 1" fill="#e5e5ff" stroke="#b7aff4" strokeWidth="1"/>
     <path className="obake-arm" d="M82 71c13-11 20-8 18-1-1 6-10 13-17 13" fill="#e5e5ff" stroke="#b7aff4" strokeWidth="1"/>
     <path d="M25 68c0-31 14-44 31-44s31 14 31 43c0 14-4 23-12 31-9 9-2 11 10 9-9 13-34 10-44-1-10-11-16-22-16-38Z" fill="url(#obake-body)" stroke="#d0c9ff" strokeWidth="1.4"/>
     <path d="m43 27 3-12 22 4-2 28-20-3Z" fill="#dbfaff" stroke="#82dce0" strokeWidth="1"/>
     <text x="55" y="37" textAnchor="middle" fontSize="14" fill="#6b6fbd" fontFamily="Yu Gothic, sans-serif">声</text>
     <g className="obake-eyes" fill="#51466e"><ellipse cx="43" cy="66" rx="4" ry="6"/><ellipse cx="69" cy="66" rx="4" ry="6"/></g>
     <circle cx="33" cy="77" r="6" fill="#f69fc9" opacity=".45"/><circle cx="79" cy="77" r="6" fill="#f69fc9" opacity=".45"/>
     <path d="M49 79q7 8 14 0" fill="none" stroke="#746088" strokeWidth="2.1" strokeLinecap="round"/>
     <circle cx="42" cy="64" r="1.1" fill="#fff"/><circle cx="68" cy="64" r="1.1" fill="#fff"/>
    </g>
   </svg>
  </button>
  <span className="obake-caption" lang="ja">こえのおばけ</span>
 </div>;
}
