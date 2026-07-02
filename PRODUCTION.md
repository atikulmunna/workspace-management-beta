# Going to Production

A readiness checklist for running the Workspace Management Service as a **real product with real users** — not a demo.

The code is production-shaped already (see [What's already done](#-whats-already-done)). Most of what's left is **operations, money, and a domain**, not more features. Work top-down: the **Blockers** section must be done before your first real user; the rest can follow as you grow.

Legend: `[ ]` todo · `[~]` partially done · `[x]` done

---

## 🚧 Blockers — before the first real user

### Hosting & data
- [ ] **Move off the $1 Railway trial.** Pick one and enable it:
  - Railway **Hobby** (~$5/mo) — stays up 24/7, zero migration, or
  - **Render** (free web service) + keep **Neon** for Postgres.
- [ ] **Turn on automated Postgres backups** (Neon has point-in-time restore — confirm the retention window on your plan). Test a restore at least once.
- [ ] **Set a real deploy branch + auto-deploy** so `master` → production is one push (build config already exists in `.github/workflows/cd.yml`).

### Secrets & config (per environment)
- [ ] Generate a **unique, strong `JWT_SECRET`** for production — never reuse the dev value. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- [ ] Set **`CORS_ORIGINS`** to your real frontend origin(s) — currently reflects all when unset (see `src/config/index.ts` / `src/app.ts`).
- [ ] Set **`APP_URL`** to the public HTTPS URL used in email links.
- [ ] Store secrets in the platform's secret manager (Railway/Render env), **not** in `.env` committed anywhere.

### Email — this IS your login, treat it as critical
- [ ] **Verify a sending domain in Resend** with SPF + DKIM. Stop using `onboarding@resend.dev` (shared sender → spam). Update `EMAIL_FROM`.
- [ ] **Handle send failures.** Today magic-link/invite sends are fire-and-forget (`.catch(console.error)` in `src/modules/auth/auth.routes.ts` and `.../invitations/invitation.routes.ts`). If a send fails, the user silently cannot log in. Add at minimum:
  - a retry (or a lightweight queue), and
  - a way for the user to re-request the link.
- [ ] Send yourself a magic link on the production domain and confirm it lands in the **inbox**, not spam.

### Frontend
- [ ] **Build a minimal client.** Real users won't use Swagger, and verification is now two-step: the emailed `GET /auth/verify?token=…` link only *validates* — a client must read the token and `POST /auth/verify` to complete sign-in. Even a single static page closes this loop.

---

## 🛡️ Hardening — as you get your first handful of users

- [ ] **Structured logging** — replace `morgan`/`console` with `pino`, attach a request ID per request, and log JSON in production.
- [ ] **Error tracking** — wire **Sentry** (or similar) into `src/middleware/errorHandler.ts` and the top-level `main().catch` in `src/index.ts`.
- [ ] **Uptime monitoring + alerts** — UptimeRobot / BetterStack pinging `/health`, alerting on 503 or downtime.
- [ ] **Refresh-token reuse detection** — currently revoked refresh tokens are deleted by cleanup; keep a short history and flag replays of an already-rotated token (indicates theft).
- [ ] **Dependency & image scanning** — `npm audit` in CI, plus a container scan (Trivy/Snyk) on the Docker image.
- [ ] **Lint gate** — add ESLint + a `lint` step to `.github/workflows/ci.yml`.
- [ ] **Test-coverage threshold** — enable coverage in `jest.config.ts` and fail CI under a floor.
- [ ] **Staging environment** — a separate deploy + database to test migrations before prod.

---

## 📈 Scale — only when you actually have traffic

> Don't do these early. They're premature until real load justifies them.

- [ ] **Shared-store rate limiting** — `express-rate-limit` is in-memory (see `src/app.ts`); move to `rate-limit-redis` before running >1 replica.
- [ ] **API versioning** — prefix routes with `/v1` so you can evolve without breaking clients.
- [ ] **Email queue / background jobs** — decouple sending from the request path.
- [ ] **`/metrics` endpoint** — Prometheus metrics for latency/throughput.
- [ ] **Connection-pool tuning** — Neon pooler is already in the `DATABASE_URL`; revisit pool sizing under load.

---

## ⚖️ If handling real people's data

- [ ] **Privacy policy + terms** (you're storing emails and names).
- [ ] Confirm account deletion is complete — `DELETE /auth/me` cascades memberships/tokens; verify nothing orphans.
- [ ] Decide on **data retention** for audit logs and revoked tokens.

---

## ✅ What's already done

So future-you doesn't redo it — this foundation is in place:

- Passwordless auth: hashed single-use tokens, JWT + rotating refresh, **O(1) indexed lookup**, prefetch-safe two-step verify.
- Four-tier RBAC with atomic role/ownership transitions; sole-owner deletion guard.
- Archive write-guard (`403 WORKSPACE_ARCHIVED`); reads + owner lifecycle still allowed.
- Audit logging inside transactions.
- Zod validation + centralized error handler with **Prisma P2002→409 / P2025→404** mapping.
- Cursor pagination on every list endpoint.
- Scheduled cleanup of spent magic-link **and** refresh tokens.
- **Graceful shutdown** (SIGTERM/SIGINT drain + DB disconnect).
- Global + per-route rate limiting with `trust proxy` set.
- 76 unit + 6 integration tests; CI runs typecheck → tests (mocked + real Postgres) → Docker build.
- OpenAPI 3.1 / Swagger UI; multi-stage non-root Dockerfile with `migrate deploy` on boot.
