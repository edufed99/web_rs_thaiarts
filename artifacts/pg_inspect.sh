#!/bin/bash
set -e
echo '--- pg_hba.conf active rules ---'
grep -E '^(host|local)' /etc/postgresql/18/main/pg_hba.conf
echo '--- listen_addresses effective ---'
sudo -u postgres psql -tAc "SHOW listen_addresses;"
echo '--- test TCP connection from inside WSL ---'
sudo -u postgres psql -h 127.0.0.1 -U postgres -d web_rs_thaiarts -tAc "SELECT 'tcp_ok';" 2>&1 || true