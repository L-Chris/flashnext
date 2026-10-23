"""Measured speech playback levels. No network calls or changes to source recordings."""
from array import array
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import wave

PROFILE = 'study-speech-loudness-v1'
TARGET_LUFS = -16.0
TOLERANCE_LU = 1.0
MAX_TRUE_PEAK = -1.5
STYLE = ('Use a clear, steady, comfortably audible speaking voice at normal conversational loudness. '
         'Do not whisper, shout, fade out, or make sudden level changes; avoid clipping. ')


class AudioLoudnessError(ValueError):
    """A fresh TTS attempt is needed; never accept this clip merely because ASR matched."""


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check_wav(data):
    with wave.open(io.BytesIO(data)) as f:
        if (f.getnchannels(), f.getsampwidth(), f.getframerate()) != (1, 2, 24000):
            raise AudioLoudnessError('Unexpected speech PCM format')
        samples = array('h', f.readframes(f.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        duration = len(samples) / 24000
    if not samples:
        raise AudioLoudnessError('Empty speech audio')
    rms = math.sqrt(sum(s * s for s in samples) / len(samples)) / 32768
    rms_db = 20 * math.log10(rms) if rms else -math.inf
    clipped = sum(abs(s) >= 32760 for s in samples) / len(samples)
    if rms_db < -42 or clipped > .01:
        raise AudioLoudnessError(f'Speech is too quiet or heavily clipped (RMS {rms_db:.1f} dBFS, clipping {clipped:.3%})')
    return dict(duration=duration, rmsDbfs=round(rms_db, 3), clippedFraction=round(clipped, 6))


def measure(path):
    # R128 requires a 400 ms window. Only pad the analysis of very short words.
    command = ['ffmpeg', '-nostdin', '-hide_banner', '-i', str(path), '-af',
               'apad=whole_dur=0.5,loudnorm=I=-16:TP=-2:print_format=json', '-f', 'null', '-']
    result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=45)
    match = re.search(r'\{\s*"input_i".*?\}', result.stderr, re.S)
    if not match:
        raise AudioLoudnessError('Audio loudness measurement is missing')
    values = json.loads(match[0])
    lufs, peak = float(values['input_i']), float(values['input_tp'])
    if not math.isfinite(lufs) or not math.isfinite(peak):
        raise AudioLoudnessError('Speech loudness is not measurable')
    return dict(lufs=lufs, truePeakDbtp=peak)


def passed(metrics):
    return (isinstance(metrics.get('lufs'), (int, float)) and
            isinstance(metrics.get('truePeakDbtp'), (int, float)) and
            math.isfinite(metrics['lufs']) and math.isfinite(metrics['truePeakDbtp']) and
            abs(metrics['lufs'] - TARGET_LUFS) <= TOLERANCE_LU and metrics['truePeakDbtp'] <= MAX_TRUE_PEAK)


def validate_processing(value, expected_hash):
    if (value.get('profile') != PROFILE or value.get('outputSha256') != expected_hash or
            value.get('targetLufs') != TARGET_LUFS or value.get('maxTruePeakDbtp') != MAX_TRUE_PEAK or
            not passed(value.get('output', {}))):
        raise AudioLoudnessError('Playback audio did not pass the current loudness policy')


def normalize(source, destination):
    """Always encode from the unchanged source; remeasure the final MP3 after every adjustment.

    A short word can be shorter than loudnorm's dynamic gain window. Use measured
    gain and an oversampled limiter instead, with bounded calibration and no time stretch.
    """
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError('Use a new playback path, separate from the original audio')
    original = measure(source)
    if original['lufs'] < -38 or original['lufs'] > -5:
        raise AudioLoudnessError('Source recording level is outside the repairable speech range')
    source_hash = file_hash(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() == '.mp3' and passed(original):
        with source.open('rb') as src, destination.open('xb') as dst:
            shutil.copyfileobj(src, dst)
        return dict(profile=PROFILE, targetLufs=TARGET_LUFS, maxTruePeakDbtp=MAX_TRUE_PEAK,
                    toleranceLu=TOLERANCE_LU, sourceSha256=source_hash, source=original,
                    output=original, outputSha256=source_hash, passes=[], bytePreserved=True)
    gain, ceiling, history = TARGET_LUFS - original['lufs'], -3.0, []
    with tempfile.TemporaryDirectory(prefix='.loudness-', dir=destination.parent) as directory:
        candidate = Path(directory) / 'playback.mp3'
        for attempt in range(8):
            if not -20 <= gain <= 24 or ceiling < -10:
                break
            filters = (f'aresample=192000,volume={gain:.6f}dB,'
                       f'alimiter=limit={10 ** (ceiling / 20):.9f}:level=false:attack=1:release=10:latency=true,'
                       'aresample=24000')
            subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(source),
                            '-map_metadata', '-1', '-af', filters, '-ar', '24000', '-ac', '1',
                            '-codec:a', 'libmp3lame', '-b:a', '64k', str(candidate)],
                           check=True, capture_output=True, timeout=45)
            output = measure(candidate)
            history.append(dict(gainDb=round(gain, 4), limiterCeilingDbfs=round(ceiling, 4), **output))
            if passed(output):
                if file_hash(source) != source_hash:
                    raise AudioLoudnessError('Source changed during audio processing')
                # Exclusive publication; a caller may have a recovery file at the destination.
                with candidate.open('rb') as src, destination.open('xb') as dst:
                    dst.write(src.read())
                return dict(profile=PROFILE, targetLufs=TARGET_LUFS, maxTruePeakDbtp=MAX_TRUE_PEAK,
                            toleranceLu=TOLERANCE_LU, sourceSha256=source_hash, source=original,
                            output=output, outputSha256=file_hash(destination), passes=history)
            if output['truePeakDbtp'] > MAX_TRUE_PEAK:
                ceiling -= output['truePeakDbtp'] - MAX_TRUE_PEAK + .15
            gain += TARGET_LUFS - output['lufs']
    raise AudioLoudnessError('Playback level could not meet loudness and peak limits after 8 local adjustments')
