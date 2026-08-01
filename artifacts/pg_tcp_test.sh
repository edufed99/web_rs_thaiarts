#!/bin/bash
# Test TCP connection to Postgres with password via env var (no prompt)
export PGPASSWORD=postgres
echo '--- TCP connect test (127.0.0.1:5432) ---'
timeout 10 psql -h 127.0.0.1 -p 5432 -U postgres -d web_rs_thaiarts -tAc "SELECT 'tcp_ok ' || current_user || '@' || current_database();" 2>&1
echo '--- TCP connect via Windows-style host (sometimes WSL needs this) ---'
timeout 10 psql -h localhost -p 5432 -U postgres -d web_rs_thaiarts -tAc "SELECT 'localhost_ok ' || version();" 2>&1 | head -5