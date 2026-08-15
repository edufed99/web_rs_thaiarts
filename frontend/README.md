# Frontend — Thai Arts Recommender

Next.js 14 (App Router) + TypeScript. Next.js is the public Application
Backend; internal model-service and PostgreSQL addresses remain server-only.

## Requirements

- Node.js 18+ (LTS recommended)
- PostgreSQL 18
- Private model service for API paths not yet migrated to Next.js

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run migration:run
npm run seed
```

Starting Next.js never changes the database schema or seed data. Run the
explicit commands above before the server, including after a deployment that
contains new migrations.

The standalone container includes a compiled migration CLI. Run its one-shot
Compose service explicitly before starting a new release:

```bash
docker compose --profile tools run --rm migrate
```

The normal frontend command remains `node server.js` and never invokes this
tooling.

## Run dev server

```bash
npm run dev
```

Open http://localhost:3000.

## Build for production

```bash
npm run build
npm start
```

## Type check

```bash
npm run type-check
```

## Rebuild the development database

The destructive rebuild is explicitly gated and disabled in production:

```bash
ALLOW_DATABASE_RESET=1 npm run db:rebuild
```

Schema synchronization is always disabled. `db:rebuild` drops the selected
development database schema, applies every TypeORM migration, and then runs
the idempotent seeds.

## Layout

```
app/
  layout.tsx          Root layout (Thai fonts, header)
  page.tsx            Home — health + metrics + CTA
  recommend/page.tsx  Form: context + keywords + top-K
  results/page.tsx    Fetch /recommendations with query params + render cards
components/
  LoadingState.tsx  ErrorState.tsx  EmptyState.tsx
  ContextPicker.tsx  KeywordPicker.tsx  RecommendationCard.tsx
lib/
  api.ts             Same-origin typed fetch client
  types.ts           Mirrors backend Pydantic schemas
db/
  migrations/        Explicit TypeORM schema history
  seeds/             Idempotent development seed data
```

## Environment

- `DATABASE_URL` — PostgreSQL connection used only by Next.js server code.
- `MEDIA_STORE_ROOT` — uploads volume root. Only files directly beneath its
  `items/` and `avatars/` directories are publicly served.
- `PRIVATE_MODEL_SERVICE_URL` and `MODEL_SERVICE_SHARED_SECRET` — server-only
  endpoint and Internal Service Credential used for the artifact-ranked
  similar-items and recommendation inference calls. The browser receives
  only enriched catalogue responses.
- `MODEL_SERVICE_TIMEOUT_MS` — per-attempt timeout for Private Model Service
  calls (default 5000, bounds 100-30000). A failed inference attempt is
  retried once; when both attempts fail the recommendation routes answer
  with the clearly identified Recommendation Fallback (`metadata.fallback`).
- `RECSYS_MAX_CANDS` / `RECSYS_MIN_CANDS` — optional Eligible Candidate Set
  cap and the adaptive-fill minimum for the eligibility gate (mirrors the
  legacy `RECSYS_*` configuration; empty `RECSYS_MAX_CANDS` means no cap).

None of these values is public browser configuration.

## Recommendations through the Application Backend

`POST /api/recommendations` and `GET /api/recommendations/profile` are served
entirely by Next.js:

1. **Eligibility** — the context-valid candidate set is built from the live
   catalogue (keyword-matched items first, optional cap with adaptive fill).
2. **Inference** — the Eligible Candidate Set plus live personalization
   inputs (positive history, negative ratings) in immutable Artifact Item
   Identifier space are sent to the Private Model Service
   (`POST /internal/v1/inference`). PostgreSQL primary keys never cross the
   boundary.
3. **Enrichment** — ranked candidates are enriched with catalogue details,
   media, member state, Thai explanations, and the display-only suitability
   hint; `scores.final` is surfaced as the public `hybrid` score.
4. **Analytics** — each context request and its ranked results are persisted
   into the legacy `recommendation_requests` / `recommendation_results`
   tables (adopted by migration
   `1787025600000-CreateRecommendationRequests`), so the existing dashboard
   trend queries keep working.
5. **Fallback** — when the model service errors or times out, the routes
   answer 200 with non-personalized context-valid results (engagement, then
   suitability hint, then name), zero model scores, a fallback explanation,
   and `metadata.fallback: true`.

Anonymous visitors personalize through the opaque `anon:<uuid>` user key;
session members personalize through `user:<id>`.

Catalogue reads (`/api/items`, item detail/similar routes, `/api/contexts`,
and `/api/keywords`) use PostgreSQL through TypeORM. Since issue #10 there
is no FastAPI compatibility path — the Application Backend is the only
public API, and the only Python process (the Private Model Service) is
called server-side with the Internal Service Credential.
