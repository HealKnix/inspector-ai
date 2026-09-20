FROM python:3.11.14-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 \
    PARSER_MODEL_ROOT=/models PARSER_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
    STORAGE_ROOT=/data PARSER_PORT=8090 PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    HF_HUB_OFFLINE=1 OMP_NUM_THREADS=2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/document-parser/requirements.lock.txt ./requirements.lock.txt
RUN pip install --requirement requirements.lock.txt
COPY backend/document-parser/ ./
RUN useradd --uid 1000 --create-home parser \
    && mkdir -p /models /data/originals /data/derived \
    && chown -R 1000:1000 /models /data \
    && chmod 700 /data/originals /data/derived
USER 1000:1000
EXPOSE 8090
CMD ["python", "server.py"]
