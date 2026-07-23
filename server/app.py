"""
WhatsMD Whisper — serviço de transcrição com PROGRESSO REAL via streaming.

Roda em cima da imagem onerahmet/openai-whisper-asr-webservice (reaproveita
faster-whisper, ffmpeg/PyAV e o cache de modelo). O faster-whisper transcreve
segmento a segmento (gerador preguiçoso); expomos cada segmento assim que sai,
então o cliente sabe exatamente quanto do áudio já foi transcrito
(segment.end / duração_total) — barra de progresso de verdade, não estimativa.

Endpoints:
  GET  /health            -> {ok, model}
  POST /transcribe-stream -> NDJSON (uma linha por segmento):
                             {"progress":0..1,"text":"parcial"} ... {"done":true,"progress":1,"text":"final"}
  POST /asr               -> texto puro (compatível com o webservice original)
"""
import json
import os
import tempfile

from faster_whisper import WhisperModel
from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse

MODEL_NAME = os.environ.get("ASR_MODEL", "small")
DOWNLOAD_ROOT = os.environ.get("ASR_MODEL_PATH", "/root/.cache/whisper")

_model = None


def get_model():
    global _model
    if _model is None:
        _model = WhisperModel(
            MODEL_NAME, device="cpu", compute_type="int8", download_root=DOWNLOAD_ROOT
        )
    return _model


app = FastAPI(title="WhatsMD Whisper Stream")
# requisições vêm do background da extensão (host_permissions), mas liberamos CORS
# para não haver surpresa em nenhum contexto.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


def _save_temp(data: bytes) -> str:
    f = tempfile.NamedTemporaryFile(delete=False, suffix=".bin")
    f.write(data)
    f.close()
    return f.name


@app.post("/transcribe-stream")
async def transcribe_stream(
    audio_file: UploadFile = File(...), language: str = Query("pt")
):
    data = await audio_file.read()
    path = _save_temp(data)

    def gen():
        try:
            segments, info = get_model().transcribe(
                path, language=language, vad_filter=True
            )
            total = getattr(info, "duration", 0) or 0
            parts = []
            for seg in segments:
                parts.append(seg.text)
                prog = min(0.999, seg.end / total) if total else 0.0
                yield json.dumps(
                    {"progress": prog, "text": "".join(parts).strip()},
                    ensure_ascii=False,
                ) + "\n"
            yield json.dumps(
                {"done": True, "progress": 1.0, "text": "".join(parts).strip()},
                ensure_ascii=False,
            ) + "\n"
        except Exception as e:  # noqa: BLE001
            yield json.dumps({"error": str(e)}) + "\n"
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/asr")
async def asr(audio_file: UploadFile = File(...), language: str = Query("pt")):
    """Compatível com o webservice original: devolve o texto puro."""
    data = await audio_file.read()
    path = _save_temp(data)
    try:
        segments, _ = get_model().transcribe(path, language=language, vad_filter=True)
        return PlainTextResponse("".join(s.text for s in segments).strip())
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
