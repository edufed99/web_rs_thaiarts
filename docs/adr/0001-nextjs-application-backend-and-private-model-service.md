# Next.js application backend and private model service

The public application will be implemented in Next.js: it owns authentication, authorization, PostgreSQL access, media, administration, analytics, and recommendation orchestration. FastAPI will be reduced to a private, authenticated model service that loads artifacts and produces inference results; neither FastAPI nor PostgreSQL will publish a host port, and IIS will expose only Next.js. TypeORM and its explicit migrations will become the sole schema authority; the development database may be reset during the cutover. This deliberately makes the application boundary clear while retaining Python where its model runtime is valuable.

## Consequences

- Next.js route handlers replace the browser-to-FastAPI `/api/*` contract currently used by `frontend/lib/api.ts`.
- Next.js preserves the current public `/api/*` route shapes during migration, while replacing their implementations incrementally.
- Google sign-in, sessions, and the current OAuth callback flow move from `backend/app/routers/auth.py` to Next.js. Browser JWT storage is replaced by secure, HttpOnly, PostgreSQL-backed sessions.
- Database ownership and migrations move from the Python SQLAlchemy/Alembic stack to TypeORM migrations; Alembic will not run after the cutover.
- TypeORM schema synchronization is disabled in every environment. Development databases may be destroyed and recreated from migrations and seeds; production data must be backed up and retained at deployment.
- Next.js preserves both password and Google sign-in. It takes over password-reset and administrative email delivery while keeping the member-login and Gmail-sender OAuth clients separate.
- The future FastAPI contract is restricted to model health and inference endpoints authenticated by an internal shared secret. Next.js assembles all inference inputs, and FastAPI returns stable artifact IDs, scores, and explanations without querying PostgreSQL.
- Next.js alone mounts and serves `uploads_data`; FastAPI neither serves media nor mounts the upload volume.
- Inference stays synchronous behind a bounded timeout and retry policy. If it cannot complete, Next.js returns a clearly identified non-personalized recommendation fallback rather than failing the page.
- Next.js constructs the eligible stable artifact-item set and all live interaction input. FastAPI returns ranked candidates and scores only; Next.js enriches them with catalogue data, media, user state, analytics, and public Thai explanations.
- Browser sessions have a seven-day maximum lifetime, rotate at login and sensitive account changes, and are revoked after password reset.
- Google Login and Gmail sender OAuth callbacks move to separate public Next.js routes and their Google Cloud redirect URIs are updated accordingly.
- Catalogue changes are visible immediately in the application but enter personalized ranking only after an explicit offline Artifact Publication.
- The model contract uses immutable Artifact Item Identifiers only. PostgreSQL primary keys remain private to Next.js, and renaming an item does not implicitly alter its artifact identity.
- Cookie-authenticated mutations use same-origin validation and CSRF protection. OAuth callback routes are the narrowly defined exception.
- Next.js preserves public catalogue and avatar media URLs while validating paths and preventing directory or arbitrary-file exposure.
- Production cutover is reversible: back up data, apply TypeORM migrations, smoke test the private model integration, switch IIS to Next.js-only, and retain the preceding images for rollback.
