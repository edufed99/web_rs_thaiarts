#!/bin/sh
set -e

# The backend image now runs ONLY the Private Model Service (issue #10):
# a database-free, artifact-only process. The public FastAPI application
# was retired after Next.js achieved full application-surface parity.
recsys_uvicorn_app="${RECSYS_UVICORN_APP:-app.private_main:app}"
exec uvicorn "$recsys_uvicorn_app" --host 0.0.0.0 --port 8001
