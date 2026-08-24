#!/bin/sh
set -e

mkdir -p /app/data/uploads/items /app/data/uploads/profiles
chown -R nextjs:nodejs /app/data/uploads
chmod -R 775 /app/data/uploads

exec su-exec nextjs "$@"