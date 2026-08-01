#!/bin/bash
# Configure Postgres to listen on all interfaces + accept password from anywhere
set -e

# 1. Set listen_addresses = '*' (comment out the existing line + add new)
PGCONF=/etc/postgresql/18/main/postgresql.conf
PGHBA=/etc/postgresql/18/main/pg_hba.conf

# Backup
cp "$PGCONF" "$PGCONF.bak.$(date +%s)" 2>/dev/null || true
cp "$PGHBA" "$PGHBA.bak.$(date +%s)" 2>/dev/null || true

# Uncomment existing listen_addresses line + set to '*'
sed -i "s|^#listen_addresses = 'localhost'|listen_addresses = '*'|" "$PGCONF"
# Ensure any other listen_addresses line is set to '*'
sed -i "s|^listen_addresses = '.*'|listen_addresses = '*'|" "$PGCONF"

# 2. Add a permissive host rule at the top (md5 password auth, all dbs, all users, any host)
# Insert after the first '# TYPE ...' comment block
if ! grep -q "^# web_appRS1 WSL bridge" "$PGHBA"; then
    sed -i "1a\\
# web_appRS1 WSL bridge (added $(date +%Y-%m-%d))\\
host    all             all             0.0.0.0/0               md5\\
host    all             all             ::/0                    md5
" "$PGHBA"
fi

# 3. Restart
service postgresql restart
sleep 2
pg_lsclusters
echo "--- new listen_addresses ---"
sudo -u postgres psql -tAc "SHOW listen_addresses;"
echo "--- new pg_hba active rules ---"
grep -E '^(host|local)' "$PGHBA" | head -10
echo "--- external listen check ---"
ss -ltn | grep 5432