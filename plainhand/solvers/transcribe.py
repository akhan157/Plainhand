"""Offline CPU speech recognition for an optional reCAPTCHA audio adapter.
Only the audio is read; no candidate profile, browser cookies, or provider keys.
"""
import argparse
import json
import re
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument('--model-dir', required=True)
parser.add_argument('--audio')
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
if args.download:
    from huggingface_hub import snapshot_download
    from huggingface_hub import model_info
    # Record and download one immutable revision rather than mixing moving files.
    revision = model_info('Systran/faster-whisper-tiny.en').sha
    snapshot_download('Systran/faster-whisper-tiny.en', revision=revision, local_dir=args.model_dir,
                      allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt', 'preprocessor_config.json'])
    model = WhisperModel(args.model_dir, device='cpu', compute_type='int8', cpu_threads=2, local_files_only=True)
    import tempfile, wave, os
    with tempfile.TemporaryDirectory() as directory:
        audio_path = os.path.join(directory, 'check.wav')
        with wave.open(audio_path, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b'\x00\x00' * 16000)
        segments, _ = model.transcribe(audio_path, language='en', beam_size=1)
        list(segments)  # Exercise decoding and inference, not only model loading.
    print(json.dumps({'ready': True, 'model': 'Systran/faster-whisper-tiny.en', 'revision': revision}))
else:
    if not args.audio:
        parser.error('--audio is required for transcription')
    model = WhisperModel(args.model_dir, device='cpu', compute_type='int8', cpu_threads=2, local_files_only=True)
    segments, _ = model.transcribe(args.audio, language='en', beam_size=5, condition_on_previous_text=False)
    text = ' '.join(segment.text for segment in segments).lower()
    text = re.sub(r'[^a-z0-9\s]', '', text)
    print(json.dumps({'text': ' '.join(text.split())[:500]}))
