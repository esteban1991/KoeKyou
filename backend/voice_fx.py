"""Efectos propios para voz: no requiere plugins comerciales ni modelos IA."""
import numpy as np
from scipy.signal import stft, istft, butter, sosfiltfilt
from scipy.ndimage import uniform_filter1d, maximum_filter1d
from pedalboard import PitchShift, PeakFilter, HighShelfFilter, LowShelfFilter
from mastering import blockwise

# Corrección por tipo de micrófono: paso alto, EQ y centro del de-esser.
MICROPHONES = {
    "generic": dict(highpass=80, deess=6500, eq=lambda: []),
    "dynamic": dict(highpass=70, deess=5500, eq=lambda: [  # oscuro: recupera presencia y aire
        PeakFilter(cutoff_frequency_hz=3500, gain_db=2, q=0.9),
        HighShelfFilter(cutoff_frequency_hz=8000, gain_db=2)]),
    "condenser": dict(highpass=90, deess=7000, eq=lambda: [  # brillante: doma 7 kHz y proximidad
        PeakFilter(cutoff_frequency_hz=250, gain_db=-1.5, q=1.0),
        PeakFilter(cutoff_frequency_hz=7500, gain_db=-1.5, q=2)]),
    "usb": dict(highpass=100, deess=6500, eq=lambda: [  # sonido de caja en 400 Hz
        PeakFilter(cutoff_frequency_hz=400, gain_db=-3, q=1.2),
        PeakFilter(cutoff_frequency_hz=5500, gain_db=-1, q=2)]),
    "lavalier": dict(highpass=100, deess=6000, eq=lambda: [  # resonancia de pecho, pierde agudos
        PeakFilter(cutoff_frequency_hz=750, gain_db=-3, q=1.4),
        HighShelfFilter(cutoff_frequency_hz=4000, gain_db=3)]),
    "laptop": dict(highpass=130, deess=5000, eq=lambda: [  # delgado y áspero
        LowShelfFilter(cutoff_frequency_hz=220, gain_db=2.5),
        PeakFilter(cutoff_frequency_hz=2500, gain_db=-3, q=1.2)]),
}

def dynamic_deess(audio, rate, amount, center=6500):
    """EQ dinámica de banda dividida, como una banda de TDR Nova: solo se atenúa
    la banda sibilante, y solo cuando su nivel supera el umbral respecto a la voz."""
    if amount <= 0:
        return audio
    low, high = center / 1.6, min(center * 1.8, rate * 0.45)
    if low >= high:
        return audio
    sos = butter(4, [low, high], btype="bandpass", fs=rate, output="sos")
    threshold = -4 - amount * 0.1          # dB de la banda respecto al total
    ratio = 2 + amount * 0.06               # hasta 8:1
    max_cut = 4 + amount * 0.12             # hasta 16 dB
    window = max(1, int(rate * 0.005))
    hop = max(1, int(rate * 0.001))

    def run(segment):
        # Fase cero: la banda se resta sin desplazamiento respecto a la señal.
        band = sosfiltfilt(sos, segment, axis=1).astype(np.float32)
        level = lambda x: 10 * np.log10(uniform_filter1d((x ** 2).mean(axis=0), window)[::hop] + 1e-12)
        side, full = level(band), level(segment)
        cut = np.clip((side - full - threshold) * (1 - 1 / ratio), 0, max_cut)
        cut[side < -60] = 0
        # Anticipación y retención (20 ms), luego suavizado: sin clics ni eses que escapen.
        cut = uniform_filter1d(maximum_filter1d(cut, 40), 15)
        gain = 10 ** (-np.repeat(cut, hop)[:segment.shape[1]] / 20)
        if gain.size < segment.shape[1]:
            gain = np.pad(gain, (0, segment.shape[1] - gain.size), mode="edge")
        return segment + (gain.astype(np.float32) - 1) * band

    return blockwise(audio, run, rate * 30, rate // 2).astype(np.float32)

def spectral_cleanup(audio, rate, denoise=0):
    if denoise <= 0:
        return audio
    result = np.empty_like(audio)
    block = int(rate * 10)
    margin = 2048
    for channel in range(audio.shape[0]):
        for start in range(0, audio.shape[1], block):
            end = min(start + block, audio.shape[1])
            left, right = max(0, start-margin), min(audio.shape[1], end+margin)
            signal = audio[channel, left:right]
            if len(signal) < 1024:
                result[channel, start:end] = audio[channel, start:end]
                continue
            frequencies, _, spectrum = stft(signal, fs=rate, nperseg=1024, noverlap=512)
            magnitude = np.abs(spectrum)
            # Estimación estadística conservadora; puede atenuar voz suave.
            floor = np.percentile(magnitude, 15, axis=1, keepdims=True)
            reduction = np.clip(floor / (magnitude + 1e-9), 0, 1)
            mask = 1 - (denoise / 100) * .85 * reduction
            mask = uniform_filter1d(mask, size=3, axis=1, mode="nearest")
            _, output = istft(spectrum * mask, fs=rate, nperseg=1024, noverlap=512)
            result[channel, start:end] = output[start-left:end-left]
    return result

def enhance(audio, rate, denoise=0, leveler=0, pitch=0, roomtail=0):
    audio = spectral_cleanup(audio, rate, denoise)
    if roomtail > 0:
        envelope = np.mean(np.abs(audio), axis=0)
        envelope = uniform_filter1d(envelope, size=max(1,int(rate*.03)))
        threshold = max(.002, float(np.percentile(envelope[::64], 35)))
        gain = np.clip(envelope / threshold, .2, 1) ** (roomtail/100)
        gain = uniform_filter1d(gain, size=max(1,int(rate*.04)))
        audio = (audio * gain).astype(np.float32)
    if leveler > 0:
        rms = float(np.sqrt(np.mean(audio[:,::8] ** 2)))
        if rms > 1e-5:
            gain_db = np.clip(-20 - 20*np.log10(rms), -12, 10) * leveler/100
            audio = audio * np.float32(10 ** (gain_db/20))
    if pitch != 0:
        audio = PitchShift(semitones=pitch)(audio, rate)
    return np.asarray(audio, dtype=np.float32)
