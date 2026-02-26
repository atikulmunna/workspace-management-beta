import request from 'supertest'
import { makeUser, makeWorkspace, makeMembership, makeToken } from './helpers'

jest.mock('../lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        workspace: { findFirst: jest.fn(), findUnique: jest.fn() },
        membership: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
        $queryRaw: jest.fn(),
    },
}))

import app from '../app'
import { prisma } from '../lib/prisma'

const db = prisma as any

// ── Test data ─────────────────────────────────────────────────────────────────

const workspace = makeWorkspace()
const owner = makeUser({ id: 'owner-id', email: 'owner@example.com' })
const adminUser = makeUser({ id: 'admin-id', email: 'admin@example.com' })
const memberUser = makeUser({ id: 'member-id', email: 'member@example.com' })
const targetUser = makeUser({ id: 'target-id', email: 'target@example.com' })

const ownerMem = makeMembership({ userId: owner.id, role: 'OWNER', workspaceId: workspace.id })
const adminMem = makeMembership({ userId: adminUser.id, role: 'ADMIN', workspaceId: workspace.id })
const memberMem = makeMembership({ userId: memberUser.id, role: 'MEMBER', workspaceId: workspace.id })
const targetMem = makeMembership({ id: 'target-mem', userId: targetUser.id, role: 'MEMBER', workspaceId: workspace.id })

const ownerToken = makeToken(owner.id, owner.email)
const adminToken = makeToken(adminUser.id, adminUser.email)
const memberToken = makeToken(memberUser.id, memberUser.email)

const BASE = '/workspaces/acme-corp/members'

/** Sets up middleware mocks for a given caller */
function authAs(caller: ReturnType<typeof makeUser>, callerMem: ReturnType<typeof makeMembership>) {
    db.user.findUnique.mockResolvedValue(caller)
    db.workspace.findFirst.mockResolvedValue(workspace)
    // requireWorkspaceMember always calls findUnique for the caller's membership first
    db.membership.findUnique.mockResolvedValueOnce(callerMem)
}

// ── GET /workspaces/:slug/members ─────────────────────────────────────────────

describe('GET /workspaces/:slug/members', () => {
    it('returns the member list for any workspace member', async () => {
        authAs(memberUser, memberMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findMany.mockResolvedValue([
            { ...ownerMem, user: owner },
            { ...memberMem, user: memberUser },
        ])

        const res = await request(app)
            .get(BASE)
            .set('Authorization', `Bearer ${memberToken}`)

        expect(res.status).toBe(200)
        expect(res.body.members).toHaveLength(2)
    })
})

// ── PATCH /workspaces/:slug/members/:userId ───────────────────────────────────

describe('PATCH /workspaces/:slug/members/:userId (role update)', () => {
    it('allows OWNER to promote a MEMBER to ADMIN', async () => {
        authAs(owner, ownerMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValueOnce(targetMem)   // target lookup
        db.membership.update.mockResolvedValue({ ...targetMem, role: 'ADMIN', user: targetUser })

        const res = await request(app)
            .patch(`${BASE}/${targetUser.id}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ role: 'ADMIN' })

        expect(res.status).toBe(200)
        expect(res.body.membership.role).toBe('ADMIN')
    })

    it('allows ADMIN to downgrade a MEMBER to VIEWER', async () => {
        authAs(adminUser, adminMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValueOnce(targetMem)
        db.membership.update.mockResolvedValue({ ...targetMem, role: 'VIEWER', user: targetUser })

        const res = await request(app)
            .patch(`${BASE}/${targetUser.id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ role: 'VIEWER' })

        expect(res.status).toBe(200)
    })

    it('MEM-05: returns 403 when trying to change the OWNER role', async () => {
        authAs(owner, ownerMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValueOnce(ownerMem)   // target IS the owner

        const res = await request(app)
            .patch(`${BASE}/${owner.id}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ role: 'ADMIN' })

        expect(res.status).toBe(403)
        expect(res.body.error.message).toMatch(/owner/)
    })

    it('MEM-06: OWNER is not in the Zod enum — returns 422 if attempted', async () => {
        authAs(owner, ownerMem)

        const res = await request(app)
            .patch(`${BASE}/${targetUser.id}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ role: 'OWNER' })   // Zod blocks this

        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 403 when a plain MEMBER tries to change a role', async () => {
        authAs(memberUser, memberMem)

        const res = await request(app)
            .patch(`${BASE}/${targetUser.id}`)
            .set('Authorization', `Bearer ${memberToken}`)
            .send({ role: 'VIEWER' })

        expect(res.status).toBe(403)
    })
})

// ── DELETE /workspaces/:slug/members/:userId ──────────────────────────────────

describe('DELETE /workspaces/:slug/members/:userId (remove member)', () => {
    it('allows ADMIN to remove a MEMBER — returns 204', async () => {
        authAs(adminUser, adminMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValueOnce(targetMem)
        db.membership.delete.mockResolvedValue(targetMem)

        const res = await request(app)
            .delete(`${BASE}/${targetUser.id}`)
            .set('Authorization', `Bearer ${adminToken}`)

        expect(res.status).toBe(204)
    })

    it('allows a MEMBER to remove themselves (self-leave)', async () => {
        authAs(memberUser, memberMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValueOnce(memberMem)   // target = self
        db.membership.delete.mockResolvedValue(memberMem)

        const res = await request(app)
            .delete(`${BASE}/${memberUser.id}`)
            .set('Authorization', `Bearer ${memberToken}`)

        expect(res.status).toBe(204)
    })

    it('MEM-10: returns 403 when attempting to remove the OWNER', async () => {
        authAs(adminUser, adminMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValueOnce(ownerMem)   // target is OWNER

        const res = await request(app)
            .delete(`${BASE}/${owner.id}`)
            .set('Authorization', `Bearer ${adminToken}`)

        expect(res.status).toBe(403)
        expect(res.body.error.message).toMatch(/owner/)
    })
})
