# Serviço de transcrição com progresso real, em cima da imagem oficial do
# whisper-asr-webservice (traz faster-whisper, PyAV/ffmpeg e o venv poetry).
FROM onerahmet/openai-whisper-asr-webservice:latest

COPY app.py /app/stream_app.py
WORKDIR /app

# a imagem base tem ENTRYPOINT ["whisper-asr-webservice"]; limpamos para rodar
# nosso app FastAPI com o python do venv (onde faster_whisper/uvicorn vivem).
ENTRYPOINT []
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "stream_app:app", "--host", "0.0.0.0", "--port", "9000"]
