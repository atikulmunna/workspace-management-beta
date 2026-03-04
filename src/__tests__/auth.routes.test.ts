import request from 'supertest'
import { makeUser, makeToken, makeMagicLinkToken } from './helpers'

// jest.mock is hoisted — the factory must NOT reference outer const/let.
// We define the mock object inside the factory and retrieve it via jest.requireMock().
jest.mock('../lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), delete: jest.fn() },
        magicLinkToken: {
            create: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        refreshToken: {
            create: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        membership: { findMany: jest.fn(), count: jest.fn() },
        invitation: { updateMany: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    },
}))

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('$2b$10$mockedhash'),
    compare: jest.fn(),
}))
jest.mock('../lib/email', () => ({
    sendMagicLinkEmail: jest.fn().mockResolvedValue(undefined),
    sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}))

import app from '../app'
import bcrypt from 'bcrypt'
import { prisma } from '../lib/prisma'

const db = prisma as any  // typed access to mocked methods

// ── Test data ─────────────────────────────────────────────────────────────────

const testUser = makeUser()

// ── POST /auth/magic-link ─────────────────────────────────────────────────────

describe('POST /auth/magic-link', () => {
    beforeEach(() => {
        db.user.upsert.mockResolvedValue(testUser)
        db.magicLinkToken.updateMany.mockResolvedValue({ count: 0 })
        db.magicLinkToken.create.mockResolvedValue({})
    })

    it('returns 200 with a generic message for a valid email', async () => {
        const res = await request(app)
            .post('/auth/magic-link')
            .send({ email: 'alice@example.com' })

        expect(res.status).toBe(200)
        expect(res.body.message).toMatch(/sign-in link has been sent/)
    })

    it('returns 200 even for a brand-new email (prevents enumeration)', async () => {
        db.user.upsert.mockResolvedValue(makeUser({ id: 'new-user' }))

        const res = await request(app)
            .post('/auth/magic-link')
            .send({ email: 'newuser@example.com' })

        expect(res.status).toBe(200)
    })

    it('returns 422 for an invalid email address', async () => {
        const res = await request(app)
            .post('/auth/magic-link')
            .send({ email: 'not-an-email' })

        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 422 when email field is missing entirely', async () => {
        const res = await request(app)
            .post('/auth/magic-link')
            .send({})

        expect(res.status).toBe(422)
    })
})

// ── GET /auth/verify ──────────────────────────────────────────────────────────

describe('GET /auth/verify', () => {
    const validRawToken = 'a'.repeat(64)  // 64 hex chars — passes format check
    const tokenRecord = makeMagicLinkToken()

    beforeEach(() => {
        db.magicLinkToken.findMany.mockResolvedValue([tokenRecord])
        db.magicLinkToken.update.mockResolvedValue({ ...tokenRecord, usedAt: new Date() })
            ; (bcrypt.compare as jest.Mock).mockResolvedValue(true)
    })

    it('returns 200 with accessToken and user on a valid token', async () => {
        const res = await request(app)
            .get(`/auth/verify?token=${validRawToken}`)

        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('accessToken')
        expect(res.body.user.email).toBe(testUser.email)
    })

    it('returns 422 when token query param is missing', async () => {
        const res = await request(app).get('/auth/verify')

        expect(res.status).toBe(422)
    })

    it('returns 401 for a token with wrong length (format guard — zero DB queries)', async () => {
        const res = await request(app)
            .get('/auth/verify?token=tooshort')

        expect(res.status).toBe(401)
        expect(db.magicLinkToken.findMany).not.toHaveBeenCalled()
    })

    it('returns 401 for a token with non-hex characters (format guard)', async () => {
        const nonHex = 'z'.repeat(64)
        const res = await request(app)
            .get(`/auth/verify?token=${nonHex}`)

        expect(res.status).toBe(401)
        expect(db.magicLinkToken.findMany).not.toHaveBeenCalled()
    })

    it('returns 401 when no matching token hash is found', async () => {
        ; (bcrypt.compare as jest.Mock).mockResolvedValue(false)

        const res = await request(app)
            .get(`/auth/verify?token=${validRawToken}`)

        expect(res.status).toBe(401)
    })
})

// ── GET /auth/me ──────────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
    it('returns 200 with user profile for a valid JWT', async () => {
        db.user.findUnique.mockResolvedValue(testUser)
        const token = makeToken(testUser.id, testUser.email)

        const res = await request(app)
            .get('/auth/me')
            .set('Authorization', `Bearer ${token}`)

        expect(res.status).toBe(200)
        expect(res.body.user.email).toBe(testUser.email)
    })

    it('returns 401 with no Authorization header', async () => {
        const res = await request(app).get('/auth/me')

        expect(res.status).toBe(401)
    })

    it('returns 401 for a tampered JWT', async () => {
        const res = await request(app)
            .get('/auth/me')
            .set('Authorization', 'Bearer eyJhbGci.tampered.token')

        expect(res.status).toBe(401)
    })
})

// ── PATCH /auth/me ────────────────────────────────────────────────────────────

describe('PATCH /auth/me', () => {
    const token = makeToken(testUser.id, testUser.email)

    it('returns 200 with updated user when name is provided', async () => {
        db.user.findUnique.mockResolvedValue(testUser)
        db.user.update.mockResolvedValue({ ...testUser, name: 'Alice Updated' })

        const res = await request(app)
            .patch('/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Alice Updated' })

        expect(res.status).toBe(200)
        expect(res.body.user.name).toBe('Alice Updated')
    })

    it('returns 200 when avatarUrl is a valid URL', async () => {
        db.user.findUnique.mockResolvedValue(testUser)
        db.user.update.mockResolvedValue({ ...testUser, avatarUrl: 'https://example.com/avatar.png' })

        const res = await request(app)
            .patch('/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ avatarUrl: 'https://example.com/avatar.png' })

        expect(res.status).toBe(200)
        expect(res.body.user.avatarUrl).toBe('https://example.com/avatar.png')
    })

    it('returns 422 for an invalid avatarUrl (not a URL)', async () => {
        db.user.findUnique.mockResolvedValue(testUser)

        const res = await request(app)
            .patch('/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ avatarUrl: 'not-a-url' })

        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 422 when body is empty (at-least-one-field guard)', async () => {
        db.user.findUnique.mockResolvedValue(testUser)

        const res = await request(app)
            .patch('/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .send({})

        expect(res.status).toBe(422)
    })

    it('returns 401 with no Authorization header', async () => {
        const res = await request(app)
            .patch('/auth/me')
            .send({ name: 'Eve' })

        expect(res.status).toBe(401)
    })
})

// ── GET /auth/verify — emailVerifiedAt ───────────────────────────────────────

describe('GET /auth/verify (emailVerifiedAt handling)', () => {
    const verifiedUser = makeUser({ emailVerifiedAt: new Date('2024-01-01') })
    const unverifiedUser = makeUser({ emailVerifiedAt: null })

    it('sets emailVerifiedAt on a user who has never verified before', async () => {
        const magicToken = makeMagicLinkToken({ user: unverifiedUser })
        db.magicLinkToken.findMany.mockResolvedValue([magicToken])
            ; (bcrypt.compare as jest.Mock).mockResolvedValue(true)
        db.magicLinkToken.update.mockResolvedValue({})
        db.user.update.mockResolvedValue({ ...unverifiedUser, emailVerifiedAt: new Date() })
        db.refreshToken.updateMany.mockResolvedValue({ count: 0 })
        db.refreshToken.create.mockResolvedValue({})

        const res = await request(app)
            .get('/auth/verify?token=' + 'a'.repeat(64))

        expect(res.status).toBe(200)
        expect(db.user.update).toHaveBeenCalledTimes(1)
        expect(res.body.user.emailVerifiedAt).toBeTruthy()
    })

    it('does NOT update emailVerifiedAt when user is already verified', async () => {
        const magicToken = makeMagicLinkToken({ user: verifiedUser })
        db.magicLinkToken.findMany.mockResolvedValue([magicToken])
            ; (bcrypt.compare as jest.Mock).mockResolvedValue(true)
        db.magicLinkToken.update.mockResolvedValue({})
        db.refreshToken.updateMany.mockResolvedValue({ count: 0 })
        db.refreshToken.create.mockResolvedValue({})

        const res = await request(app)
            .get('/auth/verify?token=' + 'a'.repeat(64))

        expect(res.status).toBe(200)
        // user.update should NOT be called because already verified
        expect(db.user.update).not.toHaveBeenCalled()
    })
})

// ── DELETE /auth/me ───────────────────────────────────────────────────────────

describe('DELETE /auth/me', () => {
    const token = makeToken(testUser.id, testUser.email)

    it('deletes account when user has no sole-owned workspaces -> 204', async () => {
        db.user.findUnique.mockResolvedValue(testUser)
        db.membership.findMany.mockResolvedValue([])  // no owned workspaces
        db.invitation.updateMany.mockResolvedValue({ count: 0 })
        db.user.delete.mockResolvedValue(testUser)

        const res = await request(app)
            .delete('/auth/me')
            .set('Authorization', `Bearer ${token}`)

        expect(res.status).toBe(204)
        expect(db.user.delete).toHaveBeenCalledTimes(1)
    })

    it('returns 409 when user is sole owner of a workspace with no other members', async () => {
        const workspace = { id: 'ws-1', slug: 'sole-ws', name: 'SoleWS' }
        db.user.findUnique.mockResolvedValue(testUser)
        db.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1', workspace }])
        db.membership.count.mockResolvedValue(0)   // no other members

        const res = await request(app)
            .delete('/auth/me')
            .set('Authorization', `Bearer ${token}`)

        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('CONFLICT')
        expect(res.body.error.message).toMatch(/sole-ws/)
    })

    it('returns 409 is bypassed when sole-owned workspace has other members -> 204', async () => {
        const workspace = { id: 'ws-2', slug: 'shared-ws', name: 'SharedWS' }
        db.user.findUnique.mockResolvedValue(testUser)
        db.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-2', workspace }])
        db.membership.count.mockResolvedValue(3)   // other members exist -> allowed
        db.invitation.updateMany.mockResolvedValue({ count: 0 })
        db.user.delete.mockResolvedValue(testUser)

        const res = await request(app)
            .delete('/auth/me')
            .set('Authorization', `Bearer ${token}`)

        expect(res.status).toBe(204)
    })

    it('returns 401 with no auth header', async () => {
        const res = await request(app).delete('/auth/me')
        expect(res.status).toBe(401)
    })
})
