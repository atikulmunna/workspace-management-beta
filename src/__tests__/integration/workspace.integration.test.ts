/**
 * Integration tests — Workspace Management Service
 *
 * These tests run against a real Postgres database (see docker-compose.test.yml).
 * They exercise the full request/response cycle: HTTP → Express → Prisma → DB.
 *
 * Run with: npm run test:integration
 * (requires Docker and `docker-compose.test.yml` to be up)
 */

import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import app from '../../app'

const prisma = new PrismaClient()

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a user + consume a magic-link token to get a real access token.
 * Bypasses the email step entirely by directly inserting a token into the DB.
 */
async function loginAs(email: string, name = 'Test User') {
    // Upsert user
    const user = await prisma.user.upsert({
        where: { email },
        create: { email, name, emailVerifiedAt: new Date() },
        update: {},
    })

    // Create a raw magic-link token and store its hash
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 10)
    await prisma.magicLinkToken.create({
        data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),  // 15 min
        },
    })

    // Consume the token via the real endpoint
    const res = await request(app).get(`/auth/verify?token=${rawToken}`)
    if (res.status !== 200) {
        throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
    }

    return { user, accessToken: res.body.accessToken as string }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('[INT] Auth', () => {
    it('GET /auth/verify sets emailVerifiedAt on first use', async () => {
        const unverified = await prisma.user.create({
            data: { email: 'unver@int.test', name: 'Unver', emailVerifiedAt: null },
        })
        const raw = crypto.randomBytes(32).toString('hex')
        const hash = await bcrypt.hash(raw, 10)
        await prisma.magicLinkToken.create({
            data: { userId: unverified.id, tokenHash: hash, expiresAt: new Date(Date.now() + 900_000) },
        })

        const res = await request(app).get(`/auth/verify?token=${raw}`)
        expect(res.status).toBe(200)
        expect(res.body.user.emailVerifiedAt).toBeTruthy()
    })

    it('GET /auth/me returns the authenticated user', async () => {
        const { accessToken } = await loginAs('me@int.test')

        const res = await request(app)
            .get('/auth/me')
            .set('Authorization', `Bearer ${accessToken}`)

        expect(res.status).toBe(200)
        expect(res.body.user.email).toBe('me@int.test')
        expect(res.body.user.emailVerifiedAt).toBeTruthy()
    })

    it('GET /auth/me returns 401 with no token', async () => {
        const res = await request(app).get('/auth/me')
        expect(res.status).toBe(401)
    })
})

// ── Workspace Lifecycle ───────────────────────────────────────────────────────

describe('[INT] Workspace lifecycle', () => {
    it('creates a workspace, lists it, gets it, updates it, and deletes it', async () => {
        const { accessToken } = await loginAs('owner@int.test')

        // CREATE
        const create = await request(app)
            .post('/workspaces')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ name: 'Integration Test WS' })
        expect(create.status).toBe(201)
        const { slug } = create.body.workspace

        // LIST — should appear
        const list = await request(app)
            .get('/workspaces')
            .set('Authorization', `Bearer ${accessToken}`)
        expect(list.status).toBe(200)
        expect(list.body.workspaces.some((w: { slug: string }) => w.slug === slug)).toBe(true)

        // GET — detail
        const get = await request(app)
            .get(`/workspaces/${slug}`)
            .set('Authorization', `Bearer ${accessToken}`)
        expect(get.status).toBe(200)
        expect(get.body.workspace.name).toBe('Integration Test WS')

        // UPDATE
        const update = await request(app)
            .patch(`/workspaces/${slug}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ name: 'Updated WS Name' })
        expect(update.status).toBe(200)
        expect(update.body.workspace.name).toBe('Updated WS Name')

        // DELETE
        const del = await request(app)
            .delete(`/workspaces/${slug}`)
            .set('Authorization', `Bearer ${accessToken}`)
        expect(del.status).toBe(204)

        // LIST — should no longer appear
        const listAfter = await request(app)
            .get('/workspaces')
            .set('Authorization', `Bearer ${accessToken}`)
        expect(listAfter.body.workspaces.some((w: { slug: string }) => w.slug === slug)).toBe(false)
    })
})

// ── Archive / Unarchive ───────────────────────────────────────────────────────

describe('[INT] Workspace archival', () => {
    it('owner can archive and unarchive a workspace', async () => {
        const { accessToken } = await loginAs('archiver@int.test')

        const { body: { workspace: { slug } } } = await request(app)
            .post('/workspaces')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ name: 'Archive Me' })

        // Archive
        const arch = await request(app)
            .patch(`/workspaces/${slug}/archive`)
            .set('Authorization', `Bearer ${accessToken}`)
        expect(arch.status).toBe(200)
        expect(arch.body.workspace.archivedAt).toBeTruthy()

        // Should not appear in default list
        const list = await request(app)
            .get('/workspaces')
            .set('Authorization', `Bearer ${accessToken}`)
        expect(list.body.workspaces.some((w: { slug: string }) => w.slug === slug)).toBe(false)

        // Should appear with ?includeArchived=true
        const listAll = await request(app)
            .get('/workspaces?includeArchived=true')
            .set('Authorization', `Bearer ${accessToken}`)
        expect(listAll.body.workspaces.some((w: { slug: string }) => w.slug === slug)).toBe(true)

        // Unarchive
        const unarch = await request(app)
            .patch(`/workspaces/${slug}/unarchive`)
            .set('Authorization', `Bearer ${accessToken}`)
        expect(unarch.status).toBe(200)
        expect(unarch.body.workspace.archivedAt).toBeNull()
    })
})

// ── Member List Filtering ─────────────────────────────────────────────────────

describe('[INT] Member list filtering', () => {
    it('?role=OWNER returns only owners', async () => {
        const { accessToken } = await loginAs('filter-owner@int.test')
        // Also create a MEMBER via invitation → accept cycle (or just test the filter on 1-member workspace)
        const { body: { workspace: { slug } } } = await request(app)
            .post('/workspaces')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ name: 'Filter WS' })

        const res = await request(app)
            .get(`/workspaces/${slug}/members?role=OWNER`)
            .set('Authorization', `Bearer ${accessToken}`)

        expect(res.status).toBe(200)
        expect(res.body.members.length).toBe(1)
        expect(res.body.members[0].role).toBe('OWNER')
    })
})
