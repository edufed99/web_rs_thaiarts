# Thai Arts Recommender System (web_rs_thaiarts)

Production web application and eligibility-gated recommender system for Thai arts and crafts with member profiles and analytics.

## Language

### Authentication & Identity

**Member Authentication (Google SSO)**:
OpenID Connect authorization flow for registered or new members, using Authorization Code with PKCE and dynamic reverse-proxy FQDN/scheme detection.
_Avoid_: Admin OAuth, Gmail OAuth sender, social login

**OAuth State Cookie**:
A short-lived, HttpOnly browser cookie containing the cryptographic OAuth state verifier, scoped to `path="/"` with SameSite=Lax and Secure enabled under HTTPS.
_Avoid_: Session cookie, URL state token


### Architecture & Reverse Proxy

**Reverse Proxy Origin (FQDN)**:
The public Fully Qualified Domain Name and protocol scheme (e.g. `https://thaiperform.fed.bpi.ac.th`) detected from forwarding headers (`X-Forwarded-Proto`, `X-Forwarded-Host`) to ensure consistent HTTPS navigation across redirects.
_Avoid_: Internal container IP, upstream localhost

**Application Backend**:
The Next.js server-side application that owns user-facing policies, identity, persistent data, media, and orchestration of recommendations.
_Avoid_: FastAPI backend, Python application tier

**Private Model Service**:
The FastAPI service that loads recommender artifacts and supplies inference results only to the Application Backend over the internal container network.
_Avoid_: Public API, browser API

**Public Application Boundary**:
The Next.js application is the sole component reachable from the public reverse proxy; its route handlers are the only public HTTP API surface.
_Avoid_: Direct model-service endpoint, public FastAPI route

**Schema Authority**:
The TypeORM migration history maintained by the Application Backend is the sole record that evolves the PostgreSQL schema after the rearchitecture.
_Avoid_: Concurrent Alembic and TypeORM migrations, manual schema changes

**Server Session**:
An opaque, database-backed login session represented in the browser only by a secure HttpOnly cookie issued by the Application Backend.
_Avoid_: Local-storage JWT, browser-managed access token

**Inference Request**:
The complete, internal request prepared by the Application Backend from persisted member state and eligibility rules for the Private Model Service to score.
_Avoid_: Browser recommendation request, model database query

**Eligible Candidate Set**:
The stable artifact-item IDs that the Application Backend has determined may be considered for a specific recommendation request.
_Avoid_: Model-selected catalogue, unfiltered item list

**Ranked Candidate**:
An artifact item identifier accompanied by model scores, returned by the Private Model Service before the Application Backend enriches it for presentation.
_Avoid_: Public recommendation card, catalogue item response

**Internal Service Credential**:
A secret held only by the Application Backend and Private Model Service that authenticates their internal requests in addition to network isolation.
_Avoid_: Browser access token, public API key

**Media Store**:
The persistent upload volume owned and served by the Application Backend for member and catalogue media.
_Avoid_: Model-service upload directory, FastAPI media server

**Recommendation Fallback**:
The non-personalized catalogue or popularity-based result presented when the Private Model Service cannot produce a ranking in time.
_Avoid_: Failed recommendation page, model error response

**Artifact Publication**:
The explicit offline release of a rebuilt recommender artifact set that makes catalogue changes available to model scoring.
_Avoid_: Implicit model update, live artifact mutation

**Artifact Item Identifier**:
The immutable stable identifier used by artifacts and the Private Model Service; the Application Backend maps it to its internal catalogue record.
_Avoid_: PostgreSQL primary key, mutable item name

### Domain Modules & Seams

**Recommendation Telemetry**:
The append-only record of recommendation requests, presented candidates, and scoring factors used to evaluate ranking quality without coupling scoring mechanics to persistent storage.
_Avoid_: Log dump, database audit trail, inline SQL write

**Catalogue Read Model**:
The unified read interface that enriches catalogue items with media, user state, and suitability scores keyed exclusively by Artifact Item Identifier.
_Avoid_: Raw SQL join helper, fragmented query bundle, router cache

**Member Identity**:
The canonical account representation that abstracts authentication providers, password recovery, and authorization states into typed properties.
_Avoid_: Raw user row, display name marker string, ad-hoc user query
