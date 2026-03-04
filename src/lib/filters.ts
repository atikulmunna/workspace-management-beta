import { z } from 'zod'

// ── Workspace list filters ────────────────────────────────────────────────────
export const workspaceFilterSchema = z.object({
    q: z.string().max(64).optional(),   // search name or slug (case-insensitive)
    includeArchived: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
})

// ── Member list filters ───────────────────────────────────────────────────────
export const memberFilterSchema = z.object({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).optional(),
})

// ── Invitation list filters ───────────────────────────────────────────────────
export const invitationFilterSchema = z.object({
    email: z.string().email().optional(),
    status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']).optional(),
})

// ── Audit log filters ─────────────────────────────────────────────────────────
export const auditLogFilterSchema = z.object({
    action: z.enum([
        'MEMBER_ROLE_CHANGED',
        'MEMBER_LEFT',
        'INVITE_SENT',
        'INVITE_ACCEPTED',
        'INVITE_REVOKED',
        'OWNERSHIP_TRANSFERRED',
    ]).optional(),
    actorId: z.string().uuid().optional(),
})
