"""Resolve an existing Whisper cache first; download only missing public model files."""
import argparse
import json
import os
from pathlib import Path
import sys

def main():
    from huggingface_hub import snapshot_download
    from faster_whisper import WhisperModel
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['small', 'base'], default='small')
    parser.add_argument('--runtime', required=True)
    args = parser.parse_args()
    root = Path(args.runtime).resolve()
    root.mkdir(parents=True, exist_ok=True)
    repo = 'Systran/faster-whisper-' + args.model
    files = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.*']
    try:
        folder = snapshot_download(repo, allow_patterns=files, local_files_only=True)
        if not (Path(folder) / 'model.bin').is_file():
            raise FileNotFoundError('Model binary missing')
    except Exception:
        folder = snapshot_download(repo, allow_patterns=files)
    # Load once to prove the cached files and CPU engine are compatible.
    model = WhisperModel(folder, device='cpu', compute_type='int8', local_files_only=True)
    config = {'python': sys.executable, 'modelPath': folder, 'model': args.model, 'device': 'cpu', 'computeType': 'int8'}
    (root / 'asr.json').write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ready': True, 'model': args.model, 'bytes': sum(p.stat().st_size for p in Path(folder).iterdir() if p.is_file())}))

if __name__ == '__main__':
    main()
