# Private Model Service v1

The Private Model Service is an internal, artifact-only FastAPI process. It
does not connect to PostgreSQL, mount `uploads_data`, serve media, or construct
browser-facing recommendation cards. During the staged migration, the legacy
FastAPI application remains available separately as the `backend` Compose
service.

Set `MODEL_SERVICE_SHARED_SECRET` to a strong, independently generated secret
in each Compose environment. Compose passes it to the model process as
`RECSYS_INTERNAL_SERVICE_SECRET`; an empty value leaves both private endpoints
unavailable. Callers authenticate with:

```http
Authorization: Bearer <shared-secret>
```

## `GET /internal/v1/health`

Returns the loaded artifact schema version and item count. It requires the
same Internal Service Credential as inference.

## `POST /internal/v1/inference`

The Application Backend performs eligibility and maps every identifier before
calling the model. The model scores exactly `eligible_candidate_ids` and never
maps PostgreSQL primary keys.

```json
{
  "eligible_candidate_ids": [184225331, 241410501],
  "personalization": {
    "context_name": "งานบวช",
    "keyword_names": ["ผู้หญิง"],
    "positive_history": [
      {"artifact_item_id": 101993716, "rating_weight": 1.0}
    ],
    "negative_ratings": [
      {"artifact_item_id": 241410501, "rating": 2}
    ]
  },
  "top_k": 10
}
```

The ordered response contains no catalogue, media, member, analytics, or
explanation fields:

```json
{
  "ranked_candidates": [
    {
      "artifact_item_id": 184225331,
      "scores": {"cbf": 0.81, "cf": 0.25, "final": 1.04}
    }
  ]
}
```

## `POST /internal/v1/similarity`

Ranks a supplied set of candidate Artifact Item Identifiers against one
reference Artifact Item Identifier using the established artifact embedding
and catalogue-metadata similarity blend. The response contains only ordered
Artifact Item Identifiers and similarity scores; Next.js owns PostgreSQL
catalogue enrichment and public media URLs.

Candidate, history, and rating identifiers are immutable Artifact Item
Identifiers. Unknown identifiers are rejected instead of being interpreted as
legacy Django or PostgreSQL IDs.
