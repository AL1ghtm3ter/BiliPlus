"""Local-only Whisper worker. Reads one JSON request from stdin; emits JSON lines."""
import json
import os
import sys

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
sys.stdout.reconfigure(encoding='utf-8')

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def main():
    from faster_whisper import WhisperModel
    request = json.load(sys.stdin)
    model = WhisperModel(request['modelPath'], device='cpu', compute_type='int8',
                         cpu_threads=min(8, os.cpu_count() or 4), local_files_only=True)
    emit({'type': 'progress', 'stage': 'transcribing', 'seconds': 0})
    language = request.get('language', 'auto')
    segments, info = model.transcribe(request['audioFile'], language=None if language == 'auto' else language,
                                      beam_size=3, vad_filter=True, condition_on_previous_text=False)
    result = []
    last_report = 0
    for segment in segments:
        content = segment.text.strip()
        if content:
            result.append({'start': round(segment.start, 3), 'end': round(segment.end, 3), 'text': content})
        if segment.end - last_report >= 20:
            last_report = segment.end
            emit({'type': 'progress', 'stage': 'transcribing', 'seconds': round(segment.end)})
    emit({'type': 'result', 'subtitles': result, 'language': info.language, 'duration': info.duration})

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print paths, signed URLs or potentially sensitive exception details.
        emit({'type': 'error', 'error': '本机语音识别失败（' + type(error).__name__ + '），请运行本机转写安装脚本检查环境。'})
        sys.exit(1)
