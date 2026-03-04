# Workspace Management Service

> A production-ready REST API for multi-tenant workspace management — handling passwordless authentication, workspaces, role-based access control, email invitations, audit logging, and interactive API documentation.

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql)](https://neon.tech)
[![Jest](https://img.shields.io/badge/Tests-62%20passing-brightgreen?logo=jest)](https://jestjs.io)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6BA539?logo=openapiinitiative)](http://localhost:3000/docs)

---

## Overview

The Workspace Management Service is a **backend microservice** that provides the foundational layer for any product needing multi-tenant team collaboration. It offers a clean, well-tested REST API covering authentication, workspace lifecycle, role enforcement, invitations, audit trails, and more — with interactive documentation built in.

### Key capabilities

- **Passwordless authentication** — magic links → bcrypt-hashed tokens → signed JWT + refresh token rotation
- **Email verification** — `emailVerifiedAt` set on first magic-link use; hard gate on sensitive writes
- **Account deletion** — `DELETE /auth/me` with sole-owner guard and cascade cleanup
- **Workspaces** — auto-slugged, full CRUD, cursor-paginated list with name/slug search
- **Workspace archival** — OWNER can archive/unarchive; archived workspaces are read-only with a 403 guard on all writes
- **Four-tier RBAC** (`OWNER > ADMIN > MEMBER > VIEWER`) enforced at middleware level
- **Invitation lifecycle** — send, accept, revoke, auto-expire; email mismatch and duplicate guards
- **Ownership transfer** — atomic two-step swap with self-transfer and non-member guards
- **Audit log** — immutable per-workspace event trail with actor tracking and action filtering
- **Cursor-based pagination** on every list endpoint (members, invitations, workspaces, audit logs)
- **Search & filtering** — query params on every list endpoint (role, email, status, action, name search)
- **OpenAPI 3.1 docs** — interactive Swagger UI at `/docs` + raw JSON spec at `/docs/openapi.json`
- **Real SMTP email** — professionally styled HTML emails via Resend (or any SMTP provider)
- **Rate limiting** on auth endpoints to resist brute-force and enumeration
- **Live health check** with real DB connectivity probe (returns 503 on failure)
- **62 unit tests** + **6 integration tests** (real Postgres via Docker)

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Language | TypeScript 5 |
| Framework | Express.js 5 |
| ORM | Prisma (PostgreSQL) |
| Database | PostgreSQL (Neon recommended) |
| Auth | Custom magic-link + HS256 JWT + refresh tokens |
| Email | Nodemailer → Resend SMTP |
| Validation | Zod |
| API Docs | OpenAPI 3.1 / Swagger UI (`@asteasolutions/zod-to-openapi`) |
| Testing | Jest + Supertest + ts-jest |
| Rate Limiting | express-rate-limit |

---

## Project Structure

```
workspace-service/
├── prisma/
│   ├── schema.prisma              # DB schema (User, Workspace, Membership, Invitation, ...)
│   └── migrations/                # Prisma migration history
├── src/
│   ├── app.ts                     # Express app + middleware + Swagger UI mount
│   ├── index.ts                   # Server entry point
│   ├── config/
│   │   └── index.ts               # Env var loading with startup-time validation
│   ├── lib/
│   │   ├── prisma.ts              # Prisma client singleton
│   │   ├── jwt.ts                 # signToken / verifyToken
│   │   ├── email.ts               # sendMagicLinkEmail / sendInvitationEmail (Resend)
│   │   ├── errors.ts              # AppError hierarchy
│   │   ├── audit.ts               # auditLogOp() — writes to AuditLog table
│   │   ├── openapi.ts             # OpenAPI registry + generateSpec()
│   │   ├── pagination.ts          # paginationSchema (limit + cursor)
│   │   └── filters.ts             # Zod filter schemas for list endpoints
│   ├── middleware/
│   │   ├── authenticate.ts        # JWT → req.currentUser
│   │   ├── authorize.ts           # requireWorkspaceMember + requireRole
│   │   ├── verifyEmail.ts         # requireVerifiedEmail (hard gate)
│   │   ├── requireActiveWorkspace.ts  # 403 guard on archived workspaces
│   │   └── errorHandler.ts        # Centralized error → JSON
│   ├── modules/
│   │   ├── auth/                  # /auth — magic-link, verify, me, refresh, logout, delete
│   │   ├── workspaces/            # /workspaces — CRUD, archive, transfer-owner, audit-logs
│   │   ├── members/               # /workspaces/:slug/members
│   │   └── invitations/           # /workspaces/:slug/invitations + /invitations/:id/accept
│   ├── docs/
│   │   ├── schemas.ts             # Reusable OpenAPI component schemas
│   │   ├── auth.docs.ts           # OpenAPI route docs — auth
│   │   ├── workspaces.docs.ts     # OpenAPI route docs — workspaces + audit
│   │   ├── members.docs.ts        # OpenAPI route docs — members
│   │   └── invitations.docs.ts    # OpenAPI route docs — invitations
│   └── __tests__/
│       ├── setup.ts               # Unit test bootstrap (mocks, env)
│       ├── helpers.ts             # makeUser / makeToken factories
│       ├── auth.routes.test.ts
│       ├── workspaces.routes.test.ts
│       ├── members.routes.test.ts
│       ├── invitations.routes.test.ts
│       └── integration/
│           ├── setup.ts           # Integration bootstrap (migrate + truncate)
│           └── workspace.integration.test.ts
├── docker-compose.test.yml        # Postgres 16 for integration tests
├── jest.config.ts                 # Unit test config
├── jest.integration.config.ts     # Integration test config
├── tsconfig.json
└── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database — [Neon](https://neon.tech) free tier recommended
- SMTP provider — [Resend](https://resend.com) free tier recommended (3,000 emails/month)
- Docker (optional, for integration tests)

### 1. Clone and install

```bash
git clone https://github.com/atikulmunna/workspace-management-beta.git
cd workspace-management-beta
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` — the minimum required values:

```env
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"   # from Neon dashboard
JWT_SECRET="<generate: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\">"
SMTP_PASS="re_xxxxxxxxxxxx"       # Resend API key from resend.com/api-keys
EMAIL_FROM="onboarding@resend.dev" # free Resend sender (or your verified domain)
APP_URL="http://localhost:3000"
```

All other values have sensible defaults (see [Environment Variables](#environment-variables)).

### 3. Set up the database

```bash
npm run db:migrate    # apply all migrations to your DB
```

### 4. Start the server

```bash
npm run dev     # development with hot reload
npm run build   # compile TypeScript → dist/
npm start       # run compiled output
```

Verify with:
```bash
curl http://localhost:3000/health
# { "status": "ok", "db": "connected" }
```

### 5. Explore the API

Open **[http://localhost:3000/docs](http://localhost:3000/docs)** for the interactive Swagger UI.

Or download the raw spec:
```bash
curl http://localhost:3000/docs/openapi.json
```

---

## Authentication Flow

Passwordless magic links — no passwords stored anywhere.

```
1. POST /auth/magic-link  { email }
   → creates/finds user, generates 256-bit random token
   → stores bcrypt hash of token in DB (raw never stored)
   → sends a styled sign-in email: APP_URL/auth/verify?token=<raw>

2. GET /auth/verify?token=<raw>
   → format guard (64 hex chars) → bcrypt.compare against DB hash
   → marks token as used (single-use), sets emailVerifiedAt on first use
   → returns { accessToken, refreshToken, user }

3. All subsequent requests:
   Authorization: Bearer <accessToken>
   → JWT verify → DB syncUser → req.currentUser

4. POST /auth/refresh  { refreshToken }
   → rotates refresh token, issues new access token

5. POST /auth/logout  { refreshToken }
   → revokes the refresh token
```

**Security properties:**
- Enumeration prevention — `POST /auth/magic-link` always returns `200`
- Format guard — non-hex or wrong-length tokens rejected before any DB query
- Single-use tokens — consumed on first successful verification
- Bcrypt-only storage — DB breach cannot expose valid tokens
- Rate limiting — 5 req/15min on magic-link, 10 req/15min on verify

---

## API Reference

All authenticated endpoints require:
```
Authorization: Bearer <JWT>
```

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/magic-link` | — | Request a sign-in email |
| `GET` | `/auth/verify?token=` | — | Verify token → JWT + refresh token |
| `POST` | `/auth/refresh` | — | Rotate refresh token |
| `POST` | `/auth/logout` | ✓ | Revoke refresh token |
| `GET` | `/auth/me` | ✓ | Get current user profile |
| `PATCH` | `/auth/me` | ✓ | Update name / avatarUrl |
| `DELETE` | `/auth/me` | ✓ | Delete account (blocked if sole workspace owner) |

---

### Workspaces

| Method | Path | Min Role | Description |
|---|---|---|---|
| `POST` | `/workspaces` | Verified ✉ | Create workspace (caller becomes OWNER) |
| `GET` | `/workspaces` | Authenticated | My workspaces (paginated + filtered) |
| `GET` | `/workspaces/:slug` | MEMBER | Get workspace detail |
| `PATCH` | `/workspaces/:slug` | ADMIN | Update name / description |
| `DELETE` | `/workspaces/:slug` | OWNER | Delete workspace |
| `PATCH` | `/workspaces/:slug/transfer-owner` | OWNER | Transfer ownership atomically |
| `PATCH` | `/workspaces/:slug/archive` | OWNER | Archive (makes workspace read-only) |
| `PATCH` | `/workspaces/:slug/unarchive` | OWNER | Restore from archive |
| `GET` | `/workspaces/:slug/audit-logs` | ADMIN | Paginated event trail |

**Query params — `GET /workspaces`:**

| Param | Type | Description |
|---|---|---|
| `q` | string | Case-insensitive name/slug search |
| `includeArchived` | `true` | Include archived workspaces (excluded by default) |
| `limit` | number | Page size (default 20, max 100) |
| `cursor` | string | Membership ID for cursor pagination |

> ✉ Email verification required — unverified users get `403` on `POST /workspaces`.

---

### Members

| Method | Path | Min Role | Notes |
|---|---|---|---|
| `GET` | `/workspaces/:slug/members` | MEMBER | Paginated member list |
| `PATCH` | `/workspaces/:slug/members/:userId` | ADMIN | Change member role |
| `DELETE` | `/workspaces/:slug/members/:userId` | ADMIN or self | Remove member |

**Query params — `GET /workspaces/:slug/members`:**

| Param | Values | Description |
|---|---|---|
| `role` | `OWNER\|ADMIN\|MEMBER\|VIEWER` | Filter by role |
| `limit` / `cursor` | — | Cursor pagination |

**Guards:** OWNER role cannot be changed; ADMIN cannot assign above own role; OWNER cannot be removed.

---

### Invitations

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/workspaces/:slug/invitations` | ADMIN | Paginated invitation list |
| `POST` | `/workspaces/:slug/invitations` | Verified ADMIN ✉ | Invite by email |
| `DELETE` | `/workspaces/:slug/invitations/:id` | ADMIN | Revoke pending invitation |
| `POST` | `/invitations/:id/accept` | Authenticated | Accept an invitation |

**Query params — `GET /workspaces/:slug/invitations`:**

| Param | Values | Description |
|---|---|---|
| `email` | string | Partial email match |
| `status` | `PENDING\|ACCEPTED\|EXPIRED\|REVOKED` | Default: `PENDING` |
| `limit` / `cursor` | — | Cursor pagination |

---

### Audit Log

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/workspaces/:slug/audit-logs` | ADMIN | Paginated audit trail |

**Query params:**

| Param | Values | Description |
|---|---|---|
| `action` | `INVITE_SENT\|INVITE_ACCEPTED\|INVITE_REVOKED\|MEMBER_ROLE_CHANGED\|MEMBER_LEFT\|OWNERSHIP_TRANSFERRED` | Filter by event type |
| `actorId` | UUID | Filter by who triggered the event |
| `limit` / `cursor` | — | Cursor pagination |

---

## Workspace Archival

Archived workspaces are **read-only**. All member write operations (update, invite, role change, etc.) return `403 WORKSPACE_ARCHIVED`. Archived workspaces are hidden from `GET /workspaces` by default.

```bash
# Archive a workspace (OWNER only)
PATCH /workspaces/acme-corp/archive

# Restore it
PATCH /workspaces/acme-corp/unarchive

# See archived workspaces in list
GET /workspaces?includeArchived=true
```

---

## Role Hierarchy

```
OWNER > ADMIN > MEMBER > VIEWER
```

| Role | Capabilities |
|---|---|
| **OWNER** | Full control. One per workspace. Cannot be removed or role-changed — use `transfer-owner`. |
| **ADMIN** | Manage members, send/revoke invitations, update workspace. Can archive. |
| **MEMBER** | Standard access. Can self-leave. |
| **VIEWER** | Read-only. |

---

## Error Responses

All errors return a consistent JSON shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [...]   // Zod field errors (validation only)
  }
}
```

| HTTP | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed request |
| 401 | `UNAUTHORIZED` | Missing / invalid / expired JWT |
| 403 | `FORBIDDEN` | Insufficient role, unverified email, or archived workspace |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Duplicate slug, existing member, pending invite, etc. |
| 422 | `VALIDATION_ERROR` | Zod schema failed |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Testing

### Unit Tests (mocked — no external services needed)

```bash
npm test              # 62 tests across 4 suites
npm run test:watch    # TDD watch mode
```

```
Test Suites: 4 passed, 4 total
Tests:       62 passed, 62 total
Time:        ~3s
```

| Suite | Tests | Coverage |
|---|---|---|
| `auth.routes` | 20 | Magic link, verify (emailVerifiedAt, format guard), /me GET/PATCH/DELETE, refresh, logout |
| `workspaces.routes` | 19 | CRUD, slug conflict, RBAC, enumeration guard, transfer-owner, email gate, pagination |
| `members.routes` | 11 | List, role update (MEM-05/06), remove (MEM-10), self-leave |
| `invitations.routes` | 12 | Send, duplicate/member guards, accept (INV-09/11/12), revoke, email gate |

### Integration Tests (real Postgres via Docker)

```bash
# 1. Start the test database
docker-compose -f docker-compose.test.yml up -d

# 2. Run integration suite (applies migrations automatically)
npm run test:integration
```

6 end-to-end tests covering: auth flow, full workspace CRUD lifecycle, archive/unarchive with list visibility, and member role filter against a real database.

---

## API Documentation

When running in `development` or `production` mode, interactive Swagger UI is available:

| URL | Description |
|---|---|
| `GET /docs` | Interactive Swagger UI (try every endpoint live) |
| `GET /docs/openapi.json` | Raw OpenAPI 3.1 JSON (import into Postman / Insomnia / codegen) |

The spec is generated from Zod schemas via `@asteasolutions/zod-to-openapi` — schemas stay in sync between runtime validation and documentation automatically.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | Yes | — | `development`, `production`, or `test` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | HS256 signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | No | `15m` | Access token lifetime |
| `REFRESH_TOKEN_EXPIRES_DAYS` | No | `30` | Refresh token lifetime (days) |
| `MAGIC_LINK_EXPIRES_MINUTES` | No | `15` | Magic link token TTL |
| `SMTP_HOST` | No | `smtp.resend.com` | SMTP server |
| `SMTP_PORT` | No | `465` | SMTP port (465=SSL, 587=STARTTLS) |
| `SMTP_USER` | No | `resend` | SMTP username |
| `SMTP_PASS` | Yes | — | SMTP password / API key |
| `EMAIL_FROM` | Yes | — | Sender address for outgoing emails |
| `APP_URL` | Yes | — | Public base URL (used in email links) |

---

## License

MIT
