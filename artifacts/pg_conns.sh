#!/bin/bash
# Inspect Postgres connection state from inside WSL
echo '--- pg_stat_activity ---'
sudo -u postgres psql -c "SELECT pid, usename, application_name, client_addr, state, query_start, LEFT(query, 50) FROM pg_stat_activity WHERE datname='web_rs_thaiarts' ORDER BY pid;" 2>&1
echo '--- connection count ---'
sudo -u postgres psql -tAc "SELECT count(*) FROM pg_stat_activity;" 2>&1
echo '--- max_connections ---'
sudo -u postgres psql -tAc "SHOW max_connections;" 2>&1