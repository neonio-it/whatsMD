# Serviço de transcrição com progresso real, em cima da imagem oficial do
# whisper-asr-webservice (traz faster-whisper, PyAV/ffmpeg e o venv poetry).
FROM onerahmet/openai-whisper-asr-webservice:latest

WORKDIR /app

# assa o modelo na imagem (build time) → sem download de 1,6GB a cada deploy,
# redeploy instantâneo e cache persistente por natureza.
# Vem ANTES do COPY de propósito: o Docker invalida a camada alterada e TODAS as
# seguintes, então com o COPY na frente qualquer mudança no app.py rebaixava o
# modelo inteiro. Nesta ordem, mexer no código reaproveita a camada do modelo.
ARG BAKE_MODEL=large-v3-turbo
RUN /app/.venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('${BAKE_MODEL}', device='cpu', compute_type='int8', download_root='/root/.cache/whisper')"

# por último: é o que mais muda
COPY app.py /app/stream_app.py

# a imagem base tem ENTRYPOINT ["whisper-asr-webservice"]; limpamos para rodar
# nosso app FastAPI com o python do venv (onde faster_whisper/uvicorn vivem).
ENTRYPOINT []
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "stream_app:app", "--host", "0.0.0.0", "--port", "9000"]
