# Serviço de transcrição com progresso real, em cima da imagem oficial do
# whisper-asr-webservice (traz faster-whisper, PyAV/ffmpeg e o venv poetry).
FROM onerahmet/openai-whisper-asr-webservice:latest

COPY app.py /app/stream_app.py
WORKDIR /app

# assa o modelo na imagem (build time) → sem download de 1,6GB a cada deploy,
# redeploy instantâneo e cache persistente por natureza
ARG BAKE_MODEL=large-v3-turbo
RUN /app/.venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('${BAKE_MODEL}', device='cpu', compute_type='int8', download_root='/root/.cache/whisper')"

# a imagem base tem ENTRYPOINT ["whisper-asr-webservice"]; limpamos para rodar
# nosso app FastAPI com o python do venv (onde faster_whisper/uvicorn vivem).
ENTRYPOINT []
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "stream_app:app", "--host", "0.0.0.0", "--port", "9000"]
