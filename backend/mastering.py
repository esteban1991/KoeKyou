"""IA de limpieza (DeepFilterNet3), sonoridad BS.1770 y limitador de pico verdadero."""
import logging
import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly, sosfilt

DF_RATE = 48000
OVERSAMPLE = 4
_model = None

def blockwise(audio, fn, block, margin):
    """Aplica fn a bloques con contexto a ambos lados para limitar la memoria."""
    length = audio.shape[1]
    if length <= block + 2 * margin:
        return fn(audio)
    output = None
    for start in range(0, length, block):
        end = min(start + block, length)
        left, right = max(0, start - margin), min(length, end + margin)
        part = fn(audio[:, left:right])[..., start - left:end - left]
        if output is None:
            output = np.empty(part.shape[:-1] + (length,), part.dtype)
        output[..., start:end] = part
    return output

def _deepfilter():
    global _model
    if _model is None:
        import torch
        from df.enhance import init_df
        torch.set_num_threads(2)
        model, state, _ = init_df(log_level="WARNING")
        _model = model, state
    return _model

def denoise_ai(audio: np.ndarray, rate: int, amount: float) -> np.ndarray:
    """DeepFilterNet3: separa la voz del ruido y de la reverberación de sala.
    amount (0-1) fija la atenuación máxima, de 6 dB a 60 dB."""
    if amount <= 0:
        return audio
    import torch
    from df.enhance import enhance
    model, state = _deepfilter()
    limit = 6 + 54 * amount
    source = audio if rate == DF_RATE else resample_poly(audio, DF_RATE, rate, axis=1)

    def run(segment):
        # Un canal por pasada: el modelo es mono.
        with torch.no_grad():
            return np.stack([
                enhance(model, state, torch.from_numpy(np.ascontiguousarray(channel[None], dtype=np.float32)),
                        atten_lim_db=limit).numpy()[0]
                for channel in segment
            ])

    # Bloques de 60 s con 1 s de contexto: el estado recurrente se estabiliza antes del corte.
    cleaned = blockwise(source, run, DF_RATE * 60, DF_RATE)
    if rate != DF_RATE:
        cleaned = resample_poly(cleaned, rate, DF_RATE, axis=1)
    cleaned = cleaned[:, :audio.shape[1]]
    if cleaned.shape[1] < audio.shape[1]:
        cleaned = np.pad(cleaned, ((0, 0), (0, audio.shape[1] - cleaned.shape[1])))
    return np.asarray(cleaned, dtype=np.float32)

def peak_envelope(audio, rate):
    """Pico entre muestras por muestra original (sobremuestreo x4, BS.1770-4 anexo 2)."""
    def run(segment):
        up = np.abs(resample_poly(segment, OVERSAMPLE, 1, axis=1).astype(np.float32)).max(axis=0)
        return up[:segment.shape[1] * OVERSAMPLE].reshape(-1, OVERSAMPLE).max(axis=1)
    return blockwise(audio, run, rate * 10, 256).astype(np.float32)

def true_peak_db(audio, rate):
    peak = float(peak_envelope(audio, rate).max(initial=0))
    return 20 * np.log10(peak) if peak > 0 else -np.inf

def true_peak_limit(audio, rate, ceiling_db=-1.0, lookahead_ms=5, hold_ms=20):
    """Limitador con anticipación: la ganancia baja antes de cada pico real.
    El mínimo se toma en una ventana mayor que el promedio, así el promedio
    nunca supera la ganancia requerida en el pico."""
    ceiling = 10 ** (ceiling_db / 20)
    needed = np.minimum(1, ceiling / np.maximum(peak_envelope(audio, rate), 1e-12))
    if needed.min() >= 1:
        return audio
    smooth = max(1, int(rate * lookahead_ms / 1000))
    window = smooth + 2 * int(rate * hold_ms / 1000)
    gain = uniform_filter1d(minimum_filter1d(needed, size=window), size=smooth)
    audio = (audio * gain.astype(np.float32)).astype(np.float32)
    # Corrección estática residual por la interpolación de la ganancia.
    excess = true_peak_db(audio, rate) - ceiling_db
    if excess > 0:
        audio *= np.float32(10 ** (-(excess + 0.05) / 20))
    return audio

def k_weighting(rate):
    """Filtro K de BS.1770 para cualquier frecuencia (coeficientes de libebur128)."""
    k = np.tan(np.pi * 1681.974450955533 / rate)
    q = 0.7071752369554196
    vh = 10 ** (3.999843853973347 / 20)
    vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0,
             1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    k = np.tan(np.pi * 38.13547087602444 / rate)
    q = 0.5003270373238773
    a0 = 1 + k / q + k * k
    highpass = [1, -2, 1, 1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    return np.array([shelf, highpass])

def loudness(audio, rate):
    """Sonoridad integrada BS.1770-4 en LUFS: bloques de 400 ms, puertas -70 y -10.
    Filtra por tramos de 60 s para no duplicar la señal completa en memoria."""
    step = int(rate * 0.1)
    steps = audio.shape[1] // step
    if steps < 4:
        return None
    sos = k_weighting(rate)
    power = np.zeros(steps)
    chunk = step * 600
    for channel in audio:
        state = np.zeros((2, 2))
        for start in range(0, steps * step, chunk):
            filtered, state = sosfilt(sos, channel[start:min(start + chunk, steps * step)], zi=state)
            power[start // step:start // step + filtered.size // step] += (filtered.reshape(-1, step) ** 2).mean(axis=1)
    blocks = (power[:-3] + power[1:-2] + power[2:-1] + power[3:]) / 4
    gated = blocks[blocks > 10 ** ((-70 + 0.691) / 10)]
    if not gated.size:
        return None
    relative = 10 ** ((-0.691 + 10 * np.log10(gated.mean()) - 10 + 0.691) / 10)
    gated = gated[gated > relative]
    return float(-0.691 + 10 * np.log10(gated.mean()))

def master(audio, rate, target_lufs=None, ceiling_db=-1.0):
    """Normaliza a target_lufs (EBU R128 / BS.1770) y limita a ceiling_db dBTP.
    Repite porque el limitador baja la sonoridad cuando actúa."""
    if target_lufs is not None:
        for _ in range(6):
            measured = loudness(audio, rate)
            if measured is None or abs(target_lufs - measured) < 0.2:
                break
            audio = audio * np.float32(10 ** (min(target_lufs - measured, 30) / 20))
            audio = true_peak_limit(audio, rate, ceiling_db)
        else:
            logging.info("La sonoridad no convergió; se conserva el último ajuste")
    return true_peak_limit(audio, rate, ceiling_db)
