# Workspace Management Service

> A production-ready REST API for multi-tenant workspace management — handling authentication, workspaces, role-based access control, and email-based invitations.

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql)](https://www.postgresql.org)
[![Jest](https://img.shields.io/badge/Tests-50%20passing-brightgreen?logo=jest)](https://jestjs.io)

---

## Overview

The Workspace Management Service is a **backend microservice** that provides the foundational layer for any product that needs multi-tenant team collaboration. It solves the problem of building authentication, workspace scoping, role enforcement, and team invitations from scratch — offering a clean, well-tested REST API that any frontend or service can integrate against.

### Key capabilities

- **Passwordless authentication** via magic links (email → bcrypt-hashed token → signed JWT)
- **Workspaces** with auto-generated slugs, creation/update/deletion, and member-count tracking
- **Four-tier RBAC** (`OWNER > ADMIN > MEMBER > VIEWER`) enforced at the route middleware level
- **Invitation lifecycle** — send, accept, revoke, auto-expire with email mismatch protection
- **Ownership transfer** — atomic two-step swap with self-transfer and non-member guards
- **Rate limiting** on auth endpoints to mitigate brute-force and enumeration attacks
- **Live health check** with real database connectivity probe (returns 503 on DB failure)
- **50 integration tests** covering happy paths, RBAC guards, validation errors, and SRS edge cases

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Language | TypeScript 5 |
| Framework | Express.js 5 |
| ORM | Prisma (PostgreSQL) |
| Auth | Custom magic-link + HS256 JWT |
| Email | Nodemailer (SMTP) |
| Validation | Zod |
| Testing | Jest + Supertest + ts-jest |
| Rate Limiting | express-rate-limit |

---

## Project Structure

```
workspace-service/
├── prisma/
│   └── schema.prisma          # Database schema (User, Workspace, Membership, Invitation, MagicLinkToken)
├── src/
│   ├── app.ts                 # Express app + middleware registration
│   ├── index.ts               # Server entry point + startup validation
│   ├── config/
│   │   └── index.ts           # Environment variable loading with startup-time validation
│   ├── lib/
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── jwt.ts             # signToken / verifyToken helpers
│   │   ├── email.ts           # sendMagicLinkEmail / sendInvitationEmail
│   │   └── errors.ts          # AppError hierarchy (ValidationError, UnauthorizedError, etc.)
│   ├── middleware/
│   │   ├── authenticate.ts    # validateToken + syncUser (JWT → req.currentUser)
│   │   ├── authorize.ts       # requireWorkspaceMember + requireRole
│   │   └── errorHandler.ts    # Centralized error → JSON response
│   ├── modules/
│   │   ├── auth/              # /auth routes (magic-link, verify, me, profile update)
│   │   ├── workspaces/        # /workspaces CRUD + transfer-owner
│   │   ├── members/           # /workspaces/:slug/members — list, role-change, remove
│   │   └── invitations/       # /workspaces/:slug/invitations + /invitations/:id/accept
│   ├── types/
│   │   └── index.ts           # Express Request augmentation (currentUser, currentMembership)
│   └── __tests__/
│       ├── setup.ts           # Test environment bootstrap
│       ├── helpers.ts         # Data factories + makeToken()
│       ├── auth.routes.test.ts
│       ├── workspaces.routes.test.ts
│       ├── members.routes.test.ts
│       └── invitations.routes.test.ts
├── jest.config.ts
├── tsconfig.json
└── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (local or hosted, e.g. Supabase, Neon, Railway)
- SMTP server for sending magic-link emails (e.g. Resend, Postmark, Mailtrap for development)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/workspace-management-beta.git
cd workspace-management-beta
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# Database (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/workspace_service"

# JWT — use a strong random secret (openssl rand -hex 64)
JWT_SECRET="your-strong-secret-here"
JWT_EXPIRES_IN="7d"

# Magic link token expiry (minutes)
MAGIC_LINK_EXPIRES_MINUTES=15

# SMTP
SMTP_HOST="smtp.mailtrap.io"
SMTP_PORT=587
SMTP_USER="your-smtp-user"
SMTP_PASS="your-smtp-password"
EMAIL_FROM="noreply@yourapp.com"

# Public URL (used to construct magic-link URLs in emails)
APP_URL="http://localhost:3000"
```

### 3. Set up the database

```bash
npm run db:generate   # generate Prisma client from schema
npm run db:migrate    # apply migrations to your database
```

### 4. Start the server

```bash
npm run dev     # development with hot reload (ts-node-dev)
npm run build   # compile TypeScript → dist/
npm start       # run compiled output
```

The server starts on `http://localhost:3000`. Verify with:

```bash
curl http://localhost:3000/health
# {"status":"ok","db":"connected"}
```

---

## Authentication Flow

This service uses **passwordless magic links** — no passwords are stored.

```
1. POST /auth/magic-link  { email }
   → creates/finds user, generates 256-bit random token
   → stores bcrypt hash of token in DB (raw token is never stored)
   → emails a sign-in link: APP_URL/auth/verify?token=<raw_token>

2. GET /auth/verify?token=<raw_token>
   → validates format (64 hex chars) before any DB query
   → bcrypt.compare against stored hashes
   → marks token as used (single-use)
   → returns signed JWT { accessToken, user }

3. All subsequent requests:
   Authorization: Bearer <accessToken>
   → validateToken (JWT verify) → syncUser (DB lookup) → req.currentUser
```

**Security properties:**
- Enumeration prevention — `POST /auth/magic-link` always returns 200
- Format guard — rejects non-hex or wrong-length tokens with zero DB queries
- Single-use tokens — consumed on first successful verification
- Bcrypt-only storage — DB breach cannot expose valid tokens
- Rate limiting — 5 req/15min on magic-link, 10 req/15min on verify (bypassed in test env)

---

## API Reference

All authenticated endpoints require:
```
Authorization: Bearer <JWT>
```

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/magic-link` | — | Request a sign-in link |
| `GET` | `/auth/verify?token=` | — | Verify token → receive JWT |
| `GET` | `/auth/me` | ✓ | Get current user profile |
| `PATCH` | `/auth/me` | ✓ | Update name / avatarUrl |

**`POST /auth/magic-link`**
```json
{ "email": "user@example.com", "name": "Alice" }
```

**`PATCH /auth/me`**
```json
{ "name": "Alice Smith", "avatarUrl": "https://example.com/avatar.png" }
```
At least one field required.

---

### Workspaces

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `POST` | `/workspaces` | Authenticated | Create workspace (caller becomes OWNER) |
| `GET` | `/workspaces` | Authenticated | List my workspaces |
| `GET` | `/workspaces/:slug` | MEMBER | Get workspace details |
| `PATCH` | `/workspaces/:slug` | ADMIN | Update name / description |
| `DELETE` | `/workspaces/:slug` | OWNER | Delete workspace |
| `PATCH` | `/workspaces/:slug/transfer-owner` | OWNER | Transfer ownership atomically |

**`POST /workspaces`**
```json
{ "name": "Acme Corp", "description": "Optional", "slug": "acme-corp" }
```
`slug` is auto-generated from `name` if not provided. Slugs are globally unique.

**`PATCH /workspaces/:slug/transfer-owner`**
```json
{ "userId": "<uuid-of-new-owner>" }
```
Atomically demotes current OWNER → ADMIN, promotes target member → OWNER. Target must be an existing member. Sending your own userId returns 403.

---

### Members

| Method | Path | Min Role | Notes |
|--------|------|----------|-------|
| `GET` | `/workspaces/:slug/members` | MEMBER | Lists all members |
| `PATCH` | `/workspaces/:slug/members/:userId` | ADMIN | Change role (not OWNER) |
| `DELETE` | `/workspaces/:slug/members/:userId` | ADMIN or self | Remove a member |

**Role update body:** `{ "role": "ADMIN" | "MEMBER" | "VIEWER" }` — `OWNER` is excluded from the Zod enum; use transfer-owner instead.

**Guards:**
- MEM-05: OWNER's role cannot be changed
- MEM-06: An ADMIN cannot assign a role higher than their own
- MEM-10: The workspace OWNER cannot be removed

---

### Invitations

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `GET` | `/workspaces/:slug/invitations` | ADMIN | List pending invitations |
| `POST` | `/workspaces/:slug/invitations` | ADMIN | Invite by email |
| `DELETE` | `/workspaces/:slug/invitations/:id` | ADMIN | Revoke a pending invitation |
| `POST` | `/invitations/:id/accept` | Authenticated | Accept an invitation |

**`POST /workspaces/:slug/invitations`**
```json
{ "email": "newmember@example.com", "role": "MEMBER" }
```

**Guards:**
- INV-02: Returns 409 if the email is already a member of this workspace
- INV-03: Returns 409 if a pending invitation already exists for this email
- INV-09: Accept returns 403 if the authenticated user's email ≠ invitation email
- INV-11: Expired invitations are marked `EXPIRED` and rejected with 403
- INV-12: Accept is atomic — membership creation + status update in a single transaction
- INV-15: Cannot revoke an already-accepted invitation (returns 409)

---

## Role Hierarchy

```
OWNER > ADMIN > MEMBER > VIEWER
```

| Role | Capabilities |
|---|---|
| **OWNER** | Full control. One per workspace. Cannot be removed or have role changed. |
| **ADMIN** | Manage members, send/revoke invitations, update workspace settings. |
| **MEMBER** | Standard workspace access. Can leave (self-remove). |
| **VIEWER** | Read-only access. |

Role checks are enforced by the `requireRole()` middleware on every route. All non-member requests receive a **403** (never 404) to prevent workspace enumeration.

---

## Error Responses

All errors follow a consistent JSON shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [...]  // Zod field errors (validation only)
  }
}
```

| HTTP Code | Error Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed request |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired JWT |
| 403 | `FORBIDDEN` | Authenticated but insufficient role |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Duplicate slug, existing member, pending invite, etc. |
| 422 | `VALIDATION_ERROR` | Zod schema failed |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Testing

The project uses **Jest + Supertest** with fully mocked Prisma, bcrypt, and email dependencies. Tests run in-process with no external services required.

```bash
npm test              # run all 50 tests once
npm run test:watch    # watch mode (TDD)
```

```
Test Suites: 4 passed, 4 total
Tests:       50 passed, 50 total
Time:        ~2.5s
```

### Test coverage by suite

| Suite | Tests | What's covered |
|---|---|---|
| `auth.routes` | 17 | Magic link, verify (format guard, bcrypt fail), /me GET+PATCH, avatarUrl validation |
| `workspaces.routes` | 16 | CRUD, slug conflict, RBAC, enumeration prevention, ownership transfer |
| `members.routes` | 8 | List, role update (MEM-05/06), remove (MEM-10), self-leave |
| `invitations.routes` | 8 | Send, duplicate/member guards, accept (INV-09/11/12), revoke (INV-15) |

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default 3000) | HTTP server port |
| `NODE_ENV` | Yes | `development`, `production`, or `test` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | HS256 signing secret (min 32 chars recommended) |
| `JWT_EXPIRES_IN` | No (default `7d`) | JWT expiry duration |
| `MAGIC_LINK_EXPIRES_MINUTES` | No (default `15`) | Magic link token TTL in minutes |
| `SMTP_HOST` | Yes | SMTP server hostname |
| `SMTP_PORT` | Yes | SMTP port (typically 587) |
| `SMTP_USER` | Yes | SMTP username |
| `SMTP_PASS` | Yes | SMTP password |
| `EMAIL_FROM` | Yes | Sender address for outgoing emails |
| `APP_URL` | Yes | Public base URL (used in magic link emails) |

---

## Roadmap

- [ ] **Refresh tokens** — short-lived access + long-lived refresh JWT rotation
- [ ] **Audit log** — immutable record of membership changes, role updates, and transfers
- [ ] **Email verification** — mark user as verified after first magic-link use
- [ ] **Pagination** — cursor-based pagination for member/invitation lists
- [ ] **Account deletion** — `DELETE /auth/me` with cascade handling

---

## License

MIT
