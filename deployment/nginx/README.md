# nginx + certbot reverse proxy (Docker)

This directory holds the public reverse proxy that replaced IIS on
`thaiperform`. nginx (in Docker) terminates public HTTPS with a Let's Encrypt
cert managed by certbot, and proxies every path — pages and `/api/*` — to the
Next.js Application Backend over the internal Docker network (`frontend:3000`).

```
Browser ──HTTPS──> nginx (Docker, host :80/:443) ──> frontend:3000 (internal net)
                  │ TLS: Let's Encrypt cert (certbot-managed, shared volume)
                  │ HTTP :80 /.well-known/acme-challenge/ -> webroot; else 301 -> https
                  └ X-Forwarded-Proto/Host set so Next.js knows it's behind HTTPS
```

IIS `W3SVC` is stopped and disabled on the host; `ftpsvc` (FTP, port 990) is
left running. `deployment/web.config` is kept in the repo as the IIS-rollback
artifact (see `../release/ROLLBACK.md`).

## Files

| File | Purpose |
|---|---|
| `nginx.conf` | main config — `events`/`http`, `client_max_body_size 110m`, gzip, `include /etc/nginx/conf.d/*.conf` |
| `conf.d/thaiarts.conf` | **steady-state** site: HTTP 80 (ACME webroot + 301 → https) and HTTPS 443 (Let's Encrypt cert, HSTS, TLSv1.2/1.3, `proxy_pass http://frontend:3000`) |
| `bootstrap/thaiarts.bootstrap.conf` | **init-only** HTTP 80 site (ACME webroot + plain-HTTP proxy, no 443/redirect). Loaded only on the first nginx start, until the cert exists |

The nginx + certbot services and the `certbot_etc` / `certbot_webroot`
volumes are declared in `../docker-compose.prod.yml`.

## Init sequence (first-time cert issuance)

These steps run on the server (`C:\Apps\ThaiArtsRecommender`). They mirror
the cutover in `../release/README.md` Phase 4.

1. **Pre-stage (IIS still up):** copy this directory to `nginx\`, add the
   nginx + certbot services to `docker-compose.yml`, and place **only**
   `bootstrap/thaiarts.bootstrap.conf` in `nginx\conf.d\` (stage
   `conf.d/thaiarts.conf` outside `conf.d\`, e.g. in `nginx\full\`). Do not
   start nginx yet.
2. **Free 80/443:** `Stop-Service W3SVC`; `Set-Service W3SVC -StartupType
   Disabled`. Verify with `Get-NetTCPConnection -LocalPort 80,443`. If
   `http.sys` still holds 443, `netsh http delete sslcert ipport=0.0.0.0:443`
   and re-verify.
3. **Start nginx (bootstrap):** `docker compose up -d nginx` — binds 80,
   proxies HTTP to `frontend:3000`. Verify
   `http://thaiperform.fed.bpi.ac.th/api/health` (Host header) →
   `{"status":"ok","database":"connected"}`.
4. **Issue the cert:**
   ```powershell
   docker compose run --rm --entrypoint certbot certbot certonly `
     --webroot -w /var/www/certbot -d thaiperform.fed.bpi.ac.th `
     -m dpatt148@gmail.com --agree-tos --no-eff-email
   ```
5. **Swap to steady-state:** move `nginx\full\thaiarts.conf` into
   `nginx\conf.d\`, delete `nginx\conf.d\thaiarts.bootstrap.conf`, then
   `docker exec thaiarts-nginx nginx -s reload` — nginx now binds 443 with
   the cert and 80 redirects to https.
6. **Start the renewal loop:** `docker compose up -d certbot`.

## Renewal

- The `certbot` container's entrypoint runs `certbot renew --quiet` every 12h
  (webroot plugin, shared volume).
- The `nginx` container's `command` runs a `while … sleep 12h … nginx -s
  reload` loop, so nginx picks up renewed cert files without a restart.
- No Docker socket is mounted; both loops are self-contained.

## Verify

```powershell
# Cert issuer = Let's Encrypt
openssl s_client -connect thaiperform.fed.bpi.ac.th:443 `
  -servername thaiperform.fed.bpi.ac.th </dev/null
# Health over HTTPS (skip cert validation, server-side)
curl -sk https://127.0.0.1/api/health -H 'Host: thaiperform.fed.bpi.ac.th'
# HTTP → 301 to https
curl -I http://thaiperform.fed.bpi.ac.th/
# Containers
docker compose ps   # thaiarts-nginx + thaiarts-certbot Up
Get-Service W3SVC   # Stopped / Disabled
Get-Service ftpsvc  # still Running
```

## Rollback (to IIS)

```powershell
cd C:\Apps\ThaiArtsRecommender
docker compose stop nginx
Set-Service W3SVC -StartupType Automatic
Start-Service W3SVC
# If you deleted the http.sys sslcert binding in step 2, re-bind it via
# netsh http add sslcert … or the IIS manager before starting W3SVC.
```

IIS reclaims 80/443; the site config + `deployment/web.config` are
unchanged, so traffic returns to the IIS+web.config path. See
`../release/ROLLBACK.md`.