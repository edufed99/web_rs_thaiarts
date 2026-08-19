# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    RECSYS_ARTIFACT_DIR=/app/artifacts \
    RECSYS_UPLOAD_DIR=/app/data/uploads

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /app/requirements.txt

COPY backend/app /app/app
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY artifacts /app/artifacts
COPY docs/research_baseline.json /app/docs/research_baseline.json

RUN mkdir -p /app/data/uploads /app/data/secrets \
    && chmod +x /app/docker-entrypoint.sh

EXPOSE 8001

CMD ["uvicorn", "app.private_main:app", "--host", "0.0.0.0", "--port", "8001"]
