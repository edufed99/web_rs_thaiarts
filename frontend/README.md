# Frontend — Thai Arts Recommender

Next.js 14 (App Router) + TypeScript. Talks to the FastAPI backend over HTTP
only — never imports Python, reads CSV, or opens model artifacts directly.

## Requirements

- Node.js 18+ (LTS recommended)
- Backend running at the URL below (see `../backend/README.md`)

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local       # optional — defaults to http://127.0.0.1:8001
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
  api.ts             Typed fetch client (uses NEXT_PUBLIC_API_BASE_URL)
  types.ts           Mirrors backend Pydantic schemas
```

## Environment

`NEXT_PUBLIC_API_BASE_URL` — defaults to `http://127.0.0.1:8001`. Set in
`.env.local` for a different backend host.