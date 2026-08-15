# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm

# Private Model Service image (issue #10): the public FastAPI application
# was retired, so the image ships only the database-free artifact scorer.

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    RECSYS_ARTIFACT_DIR=/app/artifacts

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /app/requirements.txt

COPY backend/app /app/app
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY artifacts /app/artifacts

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
