#!/bin/sh
set -e

# Run Alembic migrations if DB is enabled
if [ "${RECSYS_DB_ENABLED:-1}" != "0" ]; then
    echo "Running database migrations with Alembic..."
    python -m alembic -c /app/alembic.ini upgrade head || {
        echo "Alembic migration failed or DB not ready yet, retrying in 3 seconds..."
        sleep 3
        python -m alembic -c /app/alembic.ini upgrade head
    }
fi

echo "Starting Uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8001
