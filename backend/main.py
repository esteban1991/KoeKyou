import io
import logging
import tempfile
import threading
from pathlib import Path
from typing import Literal
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from projects import router as projects_router
from voice_fx import enhance, dynamic_deess, reduce_breaths, MICROPHONES
from mastering import denoise_ai, master, loudness, true_peak_db
from pedalboard import Pedalboard, HighpassFilter, LowShelfFilter, Compressor, HighShelfFilter, NoiseGate, Reverb
from pedalboard.io import AudioFile

app = FastAPI(title="Koe-Kyō (声響)", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Input-LUFS", "X-Output-LUFS", "X-True-Peak"],
)
app.include_router(projects_router)
MAX_BYTES = 100 * 1024 * 1024
MAX_SECONDS = 15 * 60
processing_lock = threading.Lock()
TRUE_PEAK_CEILING = -1.0

def metric(value):
    return "" if value is None or not np.isfinite(value) else f"{value:.1f}"

@app.get("/health")
def health():
    return {"status": "ok", "engine": "pedalboard+deepfilternet"}

@app.post("/process")
def process_audio(
    file: UploadFile = File(...),
    depth: float = Form(4, ge=0, le=10),
    clarity: float = Form(3, ge=0, le=8),
    compression: float = Form(55, ge=0, le=100),
    cleanup: float = Form(25, ge=0, le=100),
    deess: float = Form(0, ge=0, le=100),
    denoise: float = Form(0, ge=0, le=100),
    leveler: float = Form(0, ge=0, le=100),
    pitch: float = Form(0, ge=-6, le=6),
    roomtail: float = Form(0, ge=0, le=100),
    ai_denoise: float = Form(0, ge=0, le=100),
    breath: float = Form(0, ge=0, le=100),
    mic: Literal["generic", "dynamic", "condenser", "usb", "lavalier", "laptop"] = Form("generic"),
    loudness_target: Literal["off", "-14", "-16", "-19"] = Form("-16", alias="loudness"),
    preset: Literal["podcast", "room", "outdoor", "cathedral", "announcer"] = Form("podcast"),
):
    # Endpoint síncrono: FastAPI ejecuta el DSP en su pool de hilos.
    if not processing_lock.acquire(blocking=False):
        raise HTTPException(429, "El motor está ocupado. Inténtalo de nuevo.")
    try:
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in {".wav", ".mp3"}:
            raise HTTPException(415, "Solo se aceptan archivos WAV y MP3.")
        with tempfile.TemporaryDirectory(prefix="voicemaster-") as folder:
            source = Path(folder) / ("source" + suffix)
            size = 0
            with source.open("wb") as target:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, "El archivo supera los 100 MB.")
                    target.write(chunk)
            try:
                with AudioFile(str(source)) as reader:
                    rate = reader.samplerate
                    if reader.num_channels not in (1, 2):
                        raise HTTPException(422, "El audio debe ser mono o estéreo.")
                    if not reader.frames or reader.frames / rate > MAX_SECONDS:
                        raise HTTPException(422, "La duración debe estar entre 0 y 15 minutos.")
                    audio = reader.read(reader.frames)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(422, "El archivo está dañado o su códec no es compatible.") from exc
            if not np.isfinite(audio).all():
                raise HTTPException(422, "El audio contiene muestras inválidas.")

            input_lufs = loudness(audio, rate)
            # La IA trabaja mejor sobre la toma original, antes de cualquier EQ.
            audio = denoise_ai(audio, rate, ai_denoise / 100)
            # Antes del nivelado y la compresión, que subirían las respiraciones.
            audio = reduce_breaths(audio, rate, breath)
            audio = enhance(audio, rate, denoise, leveler, pitch, roomtail)
            if cleanup > 0:
                audio = NoiseGate(
                    threshold_db=-65 + cleanup * 0.3,
                    ratio=1 + cleanup * 0.09,
                    attack_ms=5, release_ms=160,
                )(audio, rate)

            amount = compression / 100
            profile = MICROPHONES[mic]
            audio = Pedalboard([
                HighpassFilter(cutoff_frequency_hz=profile["highpass"]),
                *profile["eq"](),
                LowShelfFilter(cutoff_frequency_hz=160, gain_db=depth),
                Compressor(threshold_db=-10 - 20 * amount, ratio=3,
                           attack_ms=10, release_ms=120),
                HighShelfFilter(cutoff_frequency_hz=4500, gain_db=clarity),
            ])(audio, rate)
            # Después del realce de agudos, que es lo que hace sobresalir las eses.
            audio = dynamic_deess(audio, rate, deess, profile["deess"])
            if preset in {"room", "cathedral"}:
                cathedral = preset == "cathedral"
                reverb = Reverb(
                    room_size=0.93 if cathedral else 0.25,
                    damping=0.35 if cathedral else 0.75,
                    wet_level=0.36 if cathedral else 0.10,
                    dry_level=0.8 if cathedral else 0.95,
                    width=1.0 if cathedral else 0.6,
                )
                audio = np.pad(audio, ((0, 0), (0, int(rate * (4 if cathedral else 1)))))
                audio = reverb(audio, rate)
            target = None if loudness_target == "off" else float(loudness_target)
            processed = master(audio, rate, target, TRUE_PEAK_CEILING)
            output = io.BytesIO()
            with AudioFile(output, "w", samplerate=rate,
                           num_channels=processed.shape[0],
                           format="wav", bit_depth=24) as writer:
                writer.write(processed)
            return Response(
                content=output.getvalue(), media_type="audio/wav",
                headers={
                    "Content-Disposition": 'attachment; filename="koe-kyo.wav"',
                    "X-Input-LUFS": metric(input_lufs),
                    "X-Output-LUFS": metric(loudness(processed, rate)),
                    "X-True-Peak": metric(true_peak_db(processed, rate)),
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        logging.exception("Audio processing failed")
        raise HTTPException(500, "No se pudo procesar el audio.") from exc
    finally:
        file.file.close()
        processing_lock.release()

@app.post("/tempo")
def tempo(file: UploadFile = File(...), speed: float = Form(1, ge=.5, le=2)):
    from pedalboard import time_stretch
    if not processing_lock.acquire(blocking=False):
        raise HTTPException(429, "El motor está ocupado. Espera a que terminen los efectos.")
    try:
        with tempfile.TemporaryDirectory(prefix="voicemaster-tempo-") as folder:
            source = Path(folder) / "input.wav"
            size = 0
            with source.open("wb") as target:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, "La pista supera los 100 MB.")
                    target.write(chunk)
            try:
                with AudioFile(str(source)) as reader:
                    rate = reader.samplerate
                    if reader.num_channels not in (1, 2) or not reader.frames:
                        raise ValueError("channels or empty file")
                    if reader.frames / rate / speed > MAX_SECONDS:
                        raise HTTPException(422, "La velocidad elegida produciría más de 15 minutos.")
                    audio = reader.read(reader.frames)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(422, "No se pudo leer la pista.") from exc
            if not np.isfinite(audio).all():
                raise HTTPException(422, "El audio contiene datos inválidos.")
            result = time_stretch(audio, rate, stretch_factor=speed)
            output = io.BytesIO()
            with AudioFile(output, "w", samplerate=rate, num_channels=result.shape[0],
                           format="wav", bit_depth=24) as writer:
                writer.write(result)
            return Response(output.getvalue(), media_type="audio/wav")
    finally:
        file.file.close()
        processing_lock.release()
