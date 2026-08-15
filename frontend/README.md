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
- `MODEL_SERVICE_URL` — private compatibility target for API paths that have
  not moved to the Application Backend yet. Next.js resolves rewrites while
  building, so container builds pass this as a server-only build argument.

Neither value is public browser configuration.
