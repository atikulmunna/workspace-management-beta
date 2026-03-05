# API Testing Guide

A step-by-step walkthrough for testing the Workspace Management API using the live Swagger UI — no Postman, no code required.

🔗 **Live Swagger UI:** https://workspace-management-beta-production.up.railway.app/docs

---

## What is Swagger UI?

Swagger UI is an interactive API browser built into the API itself. You can read what every endpoint does, fill in parameters, send real requests, and see the actual responses — all from your browser.

---

## Understanding the Interface

| Element | What it means |
|---|---|
| **Green `POST`** | Creates something new |
| **Blue `GET`** | Reads / lists data |
| **Orange `PATCH`** | Updates existing data |
| **Red `DELETE`** | Removes data permanently |
| **🔒 Lock icon** | This endpoint requires you to be logged in (a JWT token must be sent) |
| **No lock** | Public endpoint — anyone can call it |
| **Authorize button** | Where you paste your token to unlock all protected endpoints |

---

## Step 1 — Request a Magic Link (Sign In)

The API uses **passwordless authentication** — no password, just your email.

1. In Swagger UI, find the **Auth** section → click **`POST /auth/magic-link`**
2. Click **"Try it out"** (top right of the endpoint card)
3. Replace the example body with your email:
   ```json
   {
     "email": "you@example.com",
     "name": "Your Name"
   }
   ```
4. Click **Execute**
5. You will receive a response like:
   ```json
   { "message": "If an account exists for you@example.com, a sign-in link has been sent." }
   ```
6. Check your inbox — you'll have an email with a sign-in link

> **Note:** The response is always the same whether the email exists or not. This prevents attackers from checking if an email is registered.

---

## Step 2 — Verify the Link and Get Your Token

1. Click the link in the email — it looks like:
   ```
   https://workspace-management-beta-production.up.railway.app/auth/verify?token=abc123...
   ```
2. Your browser will open a response like this:
   ```json
   {
     "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
     "refreshToken": "a3f8d1b624c0e9...",
     "user": {
       "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
       "email": "you@example.com",
       "name": "Your Name"
     }
   }
   ```
3. **Copy the `accessToken` value** — you'll need it in the next step

> **Tip:** The access token expires in 15 minutes. If it expires, use `POST /auth/refresh` with your `refreshToken` to get a new pair without re-clicking an email link.

---

## Step 3 — Authorize in Swagger UI

This step "logs you in" inside Swagger UI so all locked 🔒 endpoints work.

1. Click the green **"Authorize"** button at the top right of the Swagger page
2. In the dialog that appears, paste your `accessToken` into the **Value** field under `bearerAuth`
   - Do **not** include the word `Bearer` — just paste the token itself
3. Click **Authorize** → then **Close**
4. All 🔒 lock icons are now green/filled — you're authenticated

---

## Step 4 — Check Your Profile

Verify authentication is working:

1. Find **Auth** → **`GET /auth/me`**
2. Click **"Try it out"** → **Execute**
3. You should see your user profile returned:
   ```json
   {
     "user": {
       "id": "...",
       "email": "you@example.com",
       "name": "Your Name",
       "emailVerifiedAt": "2026-01-01T00:00:00.000Z"
     }
   }
   ```

---

## Step 5 — Create a Workspace

> ⚠️ **Email verification required.** Your email must be verified to create a workspace. It is automatically verified the first time you click a magic link.

1. Find **Workspaces** → **`POST /workspaces`**
2. Click **"Try it out"**
3. Fill in the body:
   ```json
   {
     "name": "My First Workspace",
     "description": "Testing the API"
   }
   ```
4. Click **Execute**
5. You'll get a `201 Created` response with your new workspace:
   ```json
   {
     "workspace": {
       "id": "...",
       "name": "My First Workspace",
       "slug": "my-first-workspace",
       "description": "Testing the API"
     }
   }
   ```
6. **Copy the `slug`** (e.g. `my-first-workspace`) — you'll use it in all subsequent workspace calls

---

## Step 6 — List Your Workspaces

1. Find **Workspaces** → **`GET /workspaces`**
2. Click **"Try it out"** → **Execute**
3. Returns all workspaces you're a member of, including your role in each

---

## Step 7 — Invite Someone to Your Workspace

1. Find **Invitations** → **`POST /workspaces/{slug}/invitations`**
2. Click **"Try it out"**
3. Set `slug` to your workspace slug (e.g. `my-first-workspace`)
4. Fill in the body:
   ```json
   {
     "email": "colleague@example.com",
     "role": "MEMBER"
   }
   ```
   Available roles: `ADMIN`, `MEMBER`, `VIEWER`
5. Click **Execute** — an invitation email is sent to the address

---

## Step 8 — View Members

1. Find **Members** → **`GET /workspaces/{slug}/members`**
2. Click **"Try it out"**
3. Set `slug` to your workspace slug
4. Click **Execute** — returns all members with their roles

---

## Step 9 — View the Audit Log

Every important action in a workspace is recorded.

1. Find **Audit** → **`GET /workspaces/{slug}/audit-logs`**
2. Click **"Try it out"**
3. Set `slug` to your workspace slug
4. Click **Execute** — returns a list of events (invitations sent, role changes, etc.)

---

## Common Errors

| Status | Code | What it means | Fix |
|---|---|---|---|
| `401` | `UNAUTHORIZED` | Token missing, expired, or invalid | Re-authorize (Step 3), or refresh your token |
| `403` | `FORBIDDEN` | You don't have the required role, or email not verified | Check your role in the workspace, or verify your email |
| `403` | `WORKSPACE_ARCHIVED` | Workspace has been archived — read-only | Contact the workspace owner to unarchive |
| `409` | `CONFLICT` | Duplicate — e.g. invitation already exists, slug taken | Change the value causing the conflict |
| `422` | `VALIDATION_ERROR` | Request body has missing or invalid fields | Check the `issues` array in the response for field-by-field details |
| `429` | `RATE_LIMIT` | Too many magic link requests (max 5 per 15 min) | Wait 15 minutes before requesting another link |

---

## Refreshing Your Token

Access tokens expire after **15 minutes**. Use the refresh token to get a new pair:

1. Find **Auth** → **`POST /auth/refresh`**
2. Click **"Try it out"**
3. Fill in with your `refreshToken`:
   ```json
   {
     "refreshToken": "a3f8d1b624c0e9..."
   }
   ```
4. Click **Execute** — you get a new `accessToken` and `refreshToken`
5. Re-authorize in Swagger UI (Step 3) with the new `accessToken`

> Each `refreshToken` is **single-use** — it is revoked the moment you refresh. Store the new one.

---

## Logging Out

1. Find **Auth** → **`POST /auth/logout`**
2. Fill in your current `refreshToken`
3. Click **Execute** — the token is revoked immediately

---

*Have feedback on this guide? Open an issue on [GitHub](https://github.com/atikulmunna/workspace-management-beta).*
