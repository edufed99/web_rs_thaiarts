#!/bin/sh
set -e

echo "Starting Private Model Service (FastAPI)..."
exec uvicorn app.private_main:app --host 0.0.0.0 --port 8001
