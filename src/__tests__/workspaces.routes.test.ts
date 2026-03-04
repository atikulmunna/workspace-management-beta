import request from 'supertest'
import { makeUser, makeWorkspace, makeMembership, makeToken } from './helpers'

jest.mock('../lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        workspace: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        membership: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        auditLog: { create: jest.fn(), findMany: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    },
}))
jest.mock('../lib/audit', () => ({
    AuditAction: { OWNERSHIP_TRANSFERRED: 'OWNERSHIP_TRANSFERRED' },
    auditLogOp: jest.fn().mockReturnValue({ _auditNoop: true }),
}))

import app from '../app'
import { prisma } from '../lib/prisma'

const db = prisma as any

// ── Test data ─────────────────────────────────────────────────────────────────

const workspace = makeWorkspace()
const owner = makeUser({ id: 'owner-id', email: 'owner@example.com' })
const ownerMem = makeMembership({ userId: owner.id, role: 'OWNER', workspaceId: workspace.id })
const ownerToken = makeToken(owner.id, owner.email)

function authAsOwner() {
    db.user.findUnique.mockResolvedValue(owner)
    db.workspace.findFirst.mockResolvedValue(workspace)
    db.membership.findUnique.mockResolvedValue(ownerMem)
}

// ── POST /workspaces ──────────────────────────────────────────────────────────

describe('POST /workspaces', () => {
    beforeEach(() => {
        db.user.findUnique.mockResolvedValue(owner)
        db.workspace.findUnique.mockResolvedValue(null)
        db.workspace.create.mockResolvedValue(workspace)
    })

    it('creates a workspace and returns 201', async () => {
        const res = await request(app)
            .post('/workspaces')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ name: 'Acme Corp' })

        expect(res.status).toBe(201)
        expect(res.body.workspace.slug).toBe('acme-corp')
    })

    it('returns 409 when the slug is already taken', async () => {
        db.workspace.findUnique.mockResolvedValue(workspace)

        const res = await request(app)
            .post('/workspaces')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ name: 'Acme Corp', slug: 'acme-corp' })

        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('CONFLICT')
    })

    it('returns 422 for a name shorter than 2 characters', async () => {
        const res = await request(app)
            .post('/workspaces')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ name: 'X' })

        expect(res.status).toBe(422)
    })

    it('returns 401 with no auth header', async () => {
        const res = await request(app)
            .post('/workspaces')
            .send({ name: 'Acme Corp' })

        expect(res.status).toBe(401)
    })
})

// ── GET /workspaces ───────────────────────────────────────────────────────────

describe('GET /workspaces', () => {
    it('returns the list of workspaces the user belongs to', async () => {
        db.user.findUnique.mockResolvedValue(owner)
        db.membership.findMany.mockResolvedValue([{ ...ownerMem, workspace }])

        const res = await request(app)
            .get('/workspaces')
            .set('Authorization', `Bearer ${ownerToken}`)

        expect(res.status).toBe(200)
        expect(res.body.workspaces).toHaveLength(1)
        expect(res.body.workspaces[0].slug).toBe('acme-corp')
    })
})

// ── GET /workspaces/:slug ─────────────────────────────────────────────────────

describe('GET /workspaces/:slug', () => {
    it('returns workspace details for a member', async () => {
        authAsOwner()
        db.workspace.findUnique.mockResolvedValue({ ...workspace, _count: { memberships: 2 } })

        const res = await request(app)
            .get('/workspaces/acme-corp')
            .set('Authorization', `Bearer ${ownerToken}`)

        expect(res.status).toBe(200)
        expect(res.body.workspace.slug).toBe('acme-corp')
    })

    it('WS-09: returns 403 (not 404) when caller is not a member', async () => {
        db.user.findUnique.mockResolvedValue(owner)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(null)

        const res = await request(app)
            .get('/workspaces/acme-corp')
            .set('Authorization', `Bearer ${ownerToken}`)

        expect(res.status).toBe(403)
    })
})

// ── PATCH /workspaces/:slug ───────────────────────────────────────────────────

describe('PATCH /workspaces/:slug', () => {
    it('allows ADMIN to update workspace details', async () => {
        const adminUser = makeUser({ id: 'admin-id', email: 'admin@example.com' })
        const adminMem = makeMembership({ userId: adminUser.id, role: 'ADMIN' })
        db.user.findUnique.mockResolvedValue(adminUser)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(adminMem)
        db.workspace.update.mockResolvedValue({ ...workspace, name: 'Renamed' })

        const res = await request(app)
            .patch('/workspaces/acme-corp')
            .set('Authorization', `Bearer ${makeToken(adminUser.id, adminUser.email)}`)
            .send({ name: 'Renamed' })

        expect(res.status).toBe(200)
        expect(res.body.workspace.name).toBe('Renamed')
    })

    it('returns 403 when a MEMBER tries to update', async () => {
        const member = makeUser({ id: 'member-id', email: 'member@example.com' })
        const memberMem = makeMembership({ userId: member.id, role: 'MEMBER' })
        db.user.findUnique.mockResolvedValue(member)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(memberMem)

        const res = await request(app)
            .patch('/workspaces/acme-corp')
            .set('Authorization', `Bearer ${makeToken(member.id, member.email)}`)
            .send({ name: 'Will fail' })

        expect(res.status).toBe(403)
    })
})

// ── DELETE /workspaces/:slug ──────────────────────────────────────────────────

describe('DELETE /workspaces/:slug', () => {
    it('allows OWNER to delete workspace and returns 204', async () => {
        authAsOwner()
        db.workspace.delete.mockResolvedValue(workspace)

        const res = await request(app)
            .delete('/workspaces/acme-corp')
            .set('Authorization', `Bearer ${ownerToken}`)

        expect(res.status).toBe(204)
    })

    it('returns 403 when an ADMIN tries to delete', async () => {
        const adminUser = makeUser({ id: 'admin-id', email: 'admin@example.com' })
        db.user.findUnique.mockResolvedValue(adminUser)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(
            makeMembership({ userId: adminUser.id, role: 'ADMIN' })
        )

        const res = await request(app)
            .delete('/workspaces/acme-corp')
            .set('Authorization', `Bearer ${makeToken(adminUser.id, adminUser.email)}`)

        expect(res.status).toBe(403)
    })
})

// ── PATCH /workspaces/:slug/transfer-owner ────────────────────────────────────
//
// membership.findUnique is called twice:
//   1. requireWorkspaceMember: caller's membership lookup
//   2. handler target lookup:  target member's membership
// Use mockImplementation to dispatch by userId.

describe('PATCH /workspaces/:slug/transfer-owner', () => {
    const uuidOwner = makeUser({ id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'uowner@example.com' })
    const uuidRecip = makeUser({ id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'urecip@example.com' })
    const uuidOwnerMem = makeMembership({ id: 'om-1', userId: uuidOwner.id, role: 'OWNER', workspaceId: workspace.id })
    const uuidRecipMem = makeMembership({ id: 'rm-1', userId: uuidRecip.id, role: 'MEMBER', workspaceId: workspace.id })
    const uuidOwnerToken = makeToken(uuidOwner.id, uuidOwner.email)

    function membershipByUserId({ targetMem = uuidRecipMem as any } = {}) {
        db.membership.findUnique.mockImplementation(({ where }: any) => {
            const uid = where?.userId_workspaceId?.userId ?? where?.userId
            if (uid === uuidOwner.id) return Promise.resolve(uuidOwnerMem)
            if (uid === uuidRecip.id) return Promise.resolve(targetMem)
            return Promise.resolve(null)
        })
    }

    it('OWNER can transfer ownership to an existing member -> 200', async () => {
        db.user.findUnique.mockResolvedValue(uuidOwner)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.workspace.findUnique.mockResolvedValue(workspace)
        membershipByUserId()
        // $transaction now returns 3 items: [demotedOwner, promotedTarget, auditLog]
        db.$transaction.mockResolvedValue([
            { ...uuidOwnerMem, role: 'ADMIN' },
            { ...uuidRecipMem, role: 'OWNER', user: uuidRecip },
            {},
        ])

        const res = await request(app)
            .patch('/workspaces/acme-corp/transfer-owner')
            .set('Authorization', `Bearer ${uuidOwnerToken}`)
            .send({ userId: uuidRecip.id })

        expect(res.status).toBe(200)
        expect(res.body.message).toMatch(/transferred/)
        expect(db.$transaction).toHaveBeenCalledTimes(1)
    })

    it('returns 403 when a non-OWNER (ADMIN) tries to transfer', async () => {
        const adminUser = makeUser({ id: 'aaaaaaaa-0000-0000-0000-000000000003', email: 'uadmin@example.com' })
        const adminMem = makeMembership({ userId: adminUser.id, role: 'ADMIN', workspaceId: workspace.id })
        db.user.findUnique.mockResolvedValue(adminUser)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(adminMem)

        const res = await request(app)
            .patch('/workspaces/acme-corp/transfer-owner')
            .set('Authorization', `Bearer ${makeToken(adminUser.id, adminUser.email)}`)
            .send({ userId: uuidRecip.id })

        expect(res.status).toBe(403)
    })

    it('returns 403 when OWNER targets themselves', async () => {
        db.user.findUnique.mockResolvedValue(uuidOwner)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(uuidOwnerMem)

        const res = await request(app)
            .patch('/workspaces/acme-corp/transfer-owner')
            .set('Authorization', `Bearer ${uuidOwnerToken}`)
            .send({ userId: uuidOwner.id })

        expect(res.status).toBe(403)
        expect(res.body.error.message).toMatch(/yourself/)
    })

    it('returns 404 when target userId is not a member', async () => {
        db.user.findUnique.mockResolvedValue(uuidOwner)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockImplementation(({ where }: any) => {
            const uid = where?.userId_workspaceId?.userId ?? where?.userId
            return Promise.resolve(uid === uuidOwner.id ? uuidOwnerMem : null)
        })

        const res = await request(app)
            .patch('/workspaces/acme-corp/transfer-owner')
            .set('Authorization', `Bearer ${uuidOwnerToken}`)
            .send({ userId: 'aaaaaaaa-bbbb-cccc-dddd-000000000099' })

        expect(res.status).toBe(404)
    })

    it('returns 422 when userId is not a valid UUID', async () => {
        db.user.findUnique.mockResolvedValue(uuidOwner)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(uuidOwnerMem)

        const res = await request(app)
            .patch('/workspaces/acme-corp/transfer-owner')
            .set('Authorization', `Bearer ${uuidOwnerToken}`)
            .send({ userId: 'not-a-uuid' })

        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
})

// ── GET /workspaces/:slug/audit-logs ─────────────────────────────────────────

describe('GET /workspaces/:slug/audit-logs', () => {
    it('returns 200 with logs for an ADMIN', async () => {
        const adminUser = makeUser({ id: 'admin-audit', email: 'audit-admin@example.com' })
        const adminMem = makeMembership({ userId: adminUser.id, role: 'ADMIN', workspaceId: workspace.id })
        db.user.findUnique.mockResolvedValue(adminUser)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(adminMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.auditLog.findMany.mockResolvedValue([
            { id: 'log-1', action: 'MEMBER_ROLE_CHANGED', actorId: adminUser.id, actor: adminUser, createdAt: new Date() },
        ])

        const res = await request(app)
            .get('/workspaces/acme-corp/audit-logs')
            .set('Authorization', `Bearer ${makeToken(adminUser.id, adminUser.email)}`)

        expect(res.status).toBe(200)
        expect(res.body.logs).toHaveLength(1)
        expect(res.body.logs[0].action).toBe('MEMBER_ROLE_CHANGED')
    })

    it('returns 403 when a MEMBER tries to view audit logs', async () => {
        const member = makeUser({ id: 'mem-audit', email: 'mem-audit@example.com' })
        const memberMem = makeMembership({ userId: member.id, role: 'MEMBER', workspaceId: workspace.id })
        db.user.findUnique.mockResolvedValue(member)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(memberMem)

        const res = await request(app)
            .get('/workspaces/acme-corp/audit-logs')
            .set('Authorization', `Bearer ${makeToken(member.id, member.email)}`)

        expect(res.status).toBe(403)
    })
})

// ── Email gate: POST /workspaces blocks unverified users ──────────────────────

describe('Email gate: POST /workspaces', () => {
    it('returns 403 when user email is not yet verified', async () => {
        const unverified = makeUser({ id: 'uver-id', email: 'uver@example.com', emailVerifiedAt: null })
        db.user.findUnique.mockResolvedValue(unverified)

        const res = await request(app)
            .post('/workspaces')
            .set('Authorization', `Bearer ${makeToken(unverified.id, unverified.email)}`)
            .send({ name: 'Secret Corp' })

        expect(res.status).toBe(403)
        expect(res.body.error.message).toMatch(/Email not verified/)
    })
})

// ── Pagination: GET /workspaces ────────────────────────────────────────────────

describe('Pagination: GET /workspaces', () => {
    it('returns nextCursor when there are more results than the limit', async () => {
        db.user.findUnique.mockResolvedValue(owner)
        // Simulate 3 memberships returned when limit=2 (limit+1 is fetched)
        const mem1 = { ...makeMembership({ id: 'mem-1', workspaceId: 'ws-1' }), workspace: makeWorkspace({ id: 'ws-1', slug: 'ws-one' }) }
        const mem2 = { ...makeMembership({ id: 'mem-2', workspaceId: 'ws-2' }), workspace: makeWorkspace({ id: 'ws-2', slug: 'ws-two' }) }
        const mem3 = { ...makeMembership({ id: 'mem-3', workspaceId: 'ws-3' }), workspace: makeWorkspace({ id: 'ws-3', slug: 'ws-three' }) }
        db.membership.findMany.mockResolvedValue([mem1, mem2, mem3])

        const res = await request(app)
            .get('/workspaces?limit=2')
            .set('Authorization', `Bearer ${ownerToken}`)

        expect(res.status).toBe(200)
        expect(res.body.workspaces).toHaveLength(2)
        expect(res.body.nextCursor).toBe('mem-2')
    })

    it('returns nextCursor=null when all results fit in one page', async () => {
        db.user.findUnique.mockResolvedValue(owner)
        const mem1 = { ...makeMembership({ id: 'mem-1' }), workspace }
        db.membership.findMany.mockResolvedValue([mem1])

        const res = await request(app)
            .get('/workspaces?limit=20')
            .set('Authorization', `Bearer ${ownerToken}`)

        expect(res.status).toBe(200)
        expect(res.body.nextCursor).toBeNull()
    })
})
