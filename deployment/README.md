# Production deployment handoff

The production application directory, `C:\Apps\ThaiArtsRecommender`, retains
only the deployed `docker-compose.yml`, `.env`, and persistent Docker volumes.
Do not copy repository source, tests, or IIS configuration into that directory.

[`web.config`](web.config) is the version-controlled source for the staged,
selective host-IIS routing rules. During the production release procedure,
ticket #11 must apply these rules to the IIS site configuration outside the
application directory. The selective Next.js rule must remain before the broad
FastAPI compatibility rule so migrated catalogue, media, and health endpoints
reach port 3000 while unmigrated APIs continue to reach port 8001.

Issue #4 only supplies and tests this handoff artifact. Do not apply it to the
host IIS site or remove the compatibility routes as part of this ticket; the
irreversible production cutover is intentionally deferred to ticket #11.
