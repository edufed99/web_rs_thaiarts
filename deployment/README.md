# Production deployment handoff

The production application directory, `C:\Apps\ThaiArtsRecommender`, retains
only the deployed `docker-compose.yml`, `.env`, and persistent Docker volumes.
Do not copy repository source, tests, or IIS configuration into that directory.

[`web.config`](web.config) is the version-controlled source for the host-IIS
routing rules. Since issue #10 the Next.js Application Backend owns the
entire public API surface: every `api/*` request is rewritten to port 3000
and nothing targets the FastAPI port (8001). FastAPI runs as the Private
Model Service on the internal Docker network only — it is never exposed by
the host reverse proxy and requires the Internal Service Credential.

During the production release procedure, ticket #11 applies these rules to
the IIS site configuration outside the application directory. The
`docker-compose.prod.yml` here is the deployable topology; the FastAPI
container's health check verifies the private contract
(`/internal/v1/health` with the shared secret) instead of a public probe.
