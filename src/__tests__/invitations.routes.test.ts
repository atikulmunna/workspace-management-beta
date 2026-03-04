import request from 'supertest'
import { makeUser, makeWorkspace, makeMembership, makeInvitation, makeToken } from './helpers'

jest.mock('../lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        workspace: { findFirst: jest.fn(), findUnique: jest.fn() },
        membership: { findUnique: jest.fn(), create: jest.fn() },
        invitation: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
    },
}))
jest.mock('../lib/email', () => ({
    sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/audit', () => ({
    AuditAction: {
        INVITE_SENT: 'INVITE_SENT',
        INVITE_ACCEPTED: 'INVITE_ACCEPTED',
        INVITE_REVOKED: 'INVITE_REVOKED',
    },
    auditLogOp: jest.fn().mockReturnValue({ _auditNoop: true }),
}))

import app from '../app'
import { prisma } from '../lib/prisma'

const db = prisma as any

// ── Test data ─────────────────────────────────────────────────────────────────

const workspace = makeWorkspace()
const adminUser = makeUser({ id: 'admin-id', email: 'admin@example.com' })
const adminMem = makeMembership({ userId: adminUser.id, role: 'ADMIN', workspaceId: workspace.id })
const adminToken = makeToken(adminUser.id, adminUser.email)
const invitation = makeInvitation()
const WS_BASE = '/workspaces/acme-corp/invitations'

// ── POST /workspaces/:slug/invitations ────────────────────────────────────────
//
// POST /invite now goes through $transaction([invitation.create, auditLogOp])
// so we mock $transaction to return [invitation, {}]

describe('POST /workspaces/:slug/invitations', () => {
    beforeEach(() => {
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(adminMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
    })

    it('INV-01: ADMIN can send an invitation and returns 201', async () => {
        db.user.findUnique.mockImplementation(({ where }: any) =>
            Promise.resolve(where.id ? adminUser : null)
        )
        db.invitation.findFirst.mockResolvedValue(null)
        db.$transaction.mockResolvedValue([invitation, {}])

        const res = await request(app)
            .post(WS_BASE)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ email: 'bob@example.com', role: 'MEMBER' })

        expect(res.status).toBe(201)
        expect(res.body.invitation.email).toBe('bob@example.com')
    })

    it('INV-02: returns 409 when invitee is already a workspace member', async () => {
        const existingMember = { ...makeUser({ id: 'existing-id' }), memberships: [adminMem] }
        db.user.findUnique.mockImplementation(({ where }: any) =>
            Promise.resolve(where.id ? adminUser : existingMember)
        )

        const res = await request(app)
            .post(WS_BASE)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ email: 'already@example.com' })

        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('CONFLICT')
    })

    it('INV-03: returns 409 when a pending invitation already exists', async () => {
        db.user.findUnique.mockImplementation(({ where }: any) =>
            Promise.resolve(where.id ? adminUser : null)
        )
        db.invitation.findFirst.mockResolvedValue(invitation)

        const res = await request(app)
            .post(WS_BASE)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ email: 'bob@example.com' })

        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('CONFLICT')
    })
})

// ── DELETE /workspaces/:slug/invitations/:id (revoke) ────────────────────────

describe('DELETE /workspaces/:slug/invitations/:invitationId (revoke)', () => {
    beforeEach(() => {
        db.user.findUnique.mockResolvedValue(adminUser)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(adminMem)
        db.workspace.findUnique.mockResolvedValue(workspace)
    })

    it('INV-14: ADMIN can revoke a PENDING invitation -> 204', async () => {
        db.invitation.findFirst.mockResolvedValue(invitation)
        db.$transaction.mockResolvedValue([{ ...invitation, status: 'REVOKED' }, {}])

        const res = await request(app)
            .delete(`${WS_BASE}/${invitation.id}`)
            .set('Authorization', `Bearer ${adminToken}`)

        expect(res.status).toBe(204)
    })

    it('INV-15: returns 409 when trying to revoke an already-accepted invitation', async () => {
        db.invitation.findFirst.mockResolvedValue({ ...invitation, status: 'ACCEPTED' })

        const res = await request(app)
            .delete(`${WS_BASE}/${invitation.id}`)
            .set('Authorization', `Bearer ${adminToken}`)

        expect(res.status).toBe(409)
    })
})

// ── POST /invitations/:id/accept ──────────────────────────────────────────────

describe('POST /invitations/:id/accept', () => {
    const invitee = makeUser({ id: 'invitee-id', email: 'bob@example.com' })
    const inviteeToken = makeToken(invitee.id, invitee.email)
    const newMembership = makeMembership({ userId: invitee.id, role: 'MEMBER' })

    it('INV-12: creates membership + marks ACCEPTED atomically -> 201', async () => {
        db.user.findUnique.mockResolvedValue(invitee)
        db.invitation.findUnique.mockResolvedValue({ ...invitation, email: invitee.email, workspace })
        // $transaction returns [membership, updatedInvitation, auditLogEntry]
        db.$transaction.mockResolvedValue([newMembership, { ...invitation, status: 'ACCEPTED' }, {}])

        const res = await request(app)
            .post(`/invitations/${invitation.id}/accept`)
            .set('Authorization', `Bearer ${inviteeToken}`)

        expect(res.status).toBe(201)
        expect(res.body.membership.userId).toBe(invitee.id)
        expect(db.$transaction).toHaveBeenCalledTimes(1)
    })

    it('INV-09: returns 403 when caller email does not match invitation email', async () => {
        const wrongUser = makeUser({ id: 'wrong-id', email: 'wrong@example.com' })
        db.user.findUnique.mockResolvedValue(wrongUser)
        db.invitation.findUnique.mockResolvedValue({
            ...invitation,
            email: 'bob@example.com',
            workspace,
        })

        const res = await request(app)
            .post(`/invitations/${invitation.id}/accept`)
            .set('Authorization', `Bearer ${makeToken(wrongUser.id, wrongUser.email)}`)

        expect(res.status).toBe(403)
    })

    it('INV-11: returns 403 for an expired invitation and marks it EXPIRED', async () => {
        db.user.findUnique.mockResolvedValue(invitee)
        db.invitation.findUnique.mockResolvedValue({
            ...invitation,
            email: invitee.email,
            expiresAt: new Date(Date.now() - 1000),
            workspace,
        })
        db.invitation.update.mockResolvedValue({ ...invitation, status: 'EXPIRED' })

        const res = await request(app)
            .post(`/invitations/${invitation.id}/accept`)
            .set('Authorization', `Bearer ${inviteeToken}`)

        expect(res.status).toBe(403)
        expect(db.invitation.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'EXPIRED' } })
        )
    })
})

// ── Email gate: POST /workspaces/:slug/invitations ────────────────────────────

describe('Email gate: POST /workspaces/:slug/invitations', () => {
    it('returns 403 when ADMIN email is not yet verified', async () => {
        const unverifiedAdmin = makeUser({ id: 'uver-admin', email: 'uver-admin@example.com', emailVerifiedAt: null })
        const unverifiedAdminMem = makeMembership({ userId: unverifiedAdmin.id, role: 'ADMIN', workspaceId: workspace.id })

        db.user.findUnique.mockResolvedValue(unverifiedAdmin)
        db.workspace.findFirst.mockResolvedValue(workspace)
        db.membership.findUnique.mockResolvedValue(unverifiedAdminMem)
        db.workspace.findUnique.mockResolvedValue(workspace)

        const res = await request(app)
            .post(WS_BASE)
            .set('Authorization', `Bearer ${makeToken(unverifiedAdmin.id, unverifiedAdmin.email)}`)
            .send({ email: 'bob@example.com', role: 'MEMBER' })

        expect(res.status).toBe(403)
        expect(res.body.error.message).toMatch(/Email not verified/)
    })
})
