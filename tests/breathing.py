"""Verificación DSP y API con voz/soplos sintéticos; no mide precisión en habla real."""
import io
import json
import urllib.request
import numpy as np
from scipy.signal import butter, sosfilt
from voice_fx import reduce_breaths
from pedalboard.io import AudioFile

def fixture(rate):
    t = np.arange(rate * 6, dtype=np.float32) / rate
    x = np.zeros_like(t)
    voice = .12*np.sin(2*np.pi*180*t)+.05*np.sin(2*np.pi*360*t)+.025*np.sin(2*np.pi*540*t)
    for start,end in ((.3,1.1),(1.7,2.7),(3.8,4.5)):
        region=(t>=start)&(t<end);x[region]=voice[region]
    noise=np.random.default_rng(2026).normal(0,1,len(t)).astype(np.float32)
    air=sosfilt(butter(4,[700,3500],btype="bandpass",fs=rate,output="sos"),noise)
    air=air/np.sqrt(np.mean(air**2))*.012
    for start,end in ((1.25,1.55),(3.05,3.4)):
        region=(t>=start)&(t<end);x[region]=air[region]
    # Ese aguda corta y voz tenue: no deben confundirse con la respiración.
    region=(t>=2.85)&(t<2.92);x[region]=.025*np.sin(2*np.pi*7000*t[region])
    region=(t>=4.7)&(t<5.4);x[region]=.008*np.sin(2*np.pi*180*t[region])
    return x[None,:]

def rms_region(audio,rate,a,b):
    return float(np.sqrt(np.mean(audio[:,int(a*rate):int(b*rate)]**2))+1e-12)

def difference(source,output,rate,a,b):
    return 20*np.log10(rms_region(output,rate,a,b)/rms_region(source,rate,a,b))

for rate in (44100,48000):
    source=fixture(rate)
    assert np.array_equal(source,reduce_breaths(source,rate,0))
    output=reduce_breaths(source,rate,100)
    breath=difference(source,output,rate,1.3,1.5)
    voice=difference(source,output,rate,.5,.95)
    quiet=difference(source,output,rate,4.85,5.25)
    sibilant=difference(source,output,rate,2.86,2.91)
    assert output.shape==source.shape and np.isfinite(output).all()
    assert breath<-15,(rate,breath)
    assert abs(voice)<.2 and abs(quiet)<.2 and abs(sibilant)<.2,(voice,quiet,sibilant)
    stereo=np.concatenate([source,source*.5],axis=0)
    result=reduce_breaths(stereo,rate,80)
    assert np.allclose(result[1],result[0]*.5)
    print(f"PASS {rate} Hz: soplo {breath:.1f} dB; voz {voice:.2f} dB; voz tenue {quiet:.2f} dB; ese {sibilant:.2f} dB; duración y estéreo conservados")

rate=48000
source=fixture(rate)
encoded=io.BytesIO()
with AudioFile(encoded,"w",samplerate=rate,num_channels=1,format="wav",bit_depth=24) as writer:
    writer.write(source)

def request(amount):
    boundary="KoeKyoBreathTest"
    fields={"depth":0,"clarity":0,"compression":0,"cleanup":0,"deess":0,"denoise":0,"leveler":0,"pitch":0,"roomtail":0,"loudness":"off","breath":amount}
    body=b""
    for name,value in fields.items():
        body+=("--"+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+str(value)+"\r\n").encode()
    body+=("--"+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="breath.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode()+encoded.getvalue()+("\r\n--"+boundary+"--\r\n").encode()
    req=urllib.request.Request("http://127.0.0.1:8000/process",data=body,headers={"Content-Type":"multipart/form-data; boundary="+boundary})
    with urllib.request.urlopen(req,timeout=120) as response:
        with AudioFile(io.BytesIO(response.read())) as reader:
            return reader.read(reader.frames)

before,after=request(0),request(80)
assert after.shape==before.shape
delta=difference(before,after,rate,1.3,1.5)
assert delta<-12,delta
assert abs(difference(before,after,rate,.5,.95))<.3
print(f"PASS API multipart: control breath=80 atenúa el soplo {delta:.1f} dB sin recortar la voz")
