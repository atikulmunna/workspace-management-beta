import { z } from 'zod'
import { registry } from '../lib/openapi'

// ── Primitives ────────────────────────────────────────────────────────────────

export const RoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).openapi({
    description: 'RBAC role within a workspace',
    example: 'MEMBER',
})

export const UuidSchema = z.string().uuid().openapi({ example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })

// ── Component schemas (registered as $ref components) ─────────────────────────

export const UserSchema = registry.register('User', z.object({
    id: UuidSchema,
    email: z.string().email().openapi({ example: 'alice@example.com' }),
    name: z.string().nullable().openapi({ example: 'Alice' }),
    avatarUrl: z.string().url().nullable().openapi({ example: 'https://example.com/avatar.png' }),
    emailVerifiedAt: z.string().datetime().nullable().openapi({ example: '2024-01-15T10:00:00.000Z' }),
    createdAt: z.string().datetime().openapi({ example: '2024-01-01T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2024-01-01T00:00:00.000Z' }),
}).openapi('User'))

export const WorkspaceSchema = registry.register('Workspace', z.object({
    id: UuidSchema,
    name: z.string().openapi({ example: 'Acme Corp' }),
    slug: z.string().openapi({ example: 'acme-corp' }),
    description: z.string().nullable().openapi({ example: 'Our main workspace' }),
    createdAt: z.string().datetime().openapi({ example: '2024-01-01T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2024-01-01T00:00:00.000Z' }),
}).openapi('Workspace'))

export const MembershipSchema = registry.register('Membership', z.object({
    id: UuidSchema,
    userId: UuidSchema,
    workspaceId: UuidSchema,
    role: RoleSchema,
    joinedAt: z.string().datetime().openapi({ example: '2024-01-01T00:00:00.000Z' }),
    user: z.object({
        id: UuidSchema,
        name: z.string().nullable().openapi({ example: 'Alice' }),
        email: z.string().email().openapi({ example: 'alice@example.com' }),
    }).optional(),
}).openapi('Membership'))

export const InvitationSchema = registry.register('Invitation', z.object({
    id: UuidSchema,
    email: z.string().email().openapi({ example: 'bob@example.com' }),
    role: RoleSchema,
    status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']).openapi({ example: 'PENDING' }),
    workspaceId: UuidSchema,
    invitedById: UuidSchema,
    expiresAt: z.string().datetime().openapi({ example: '2024-01-08T00:00:00.000Z' }),
    createdAt: z.string().datetime().openapi({ example: '2024-01-01T00:00:00.000Z' }),
}).openapi('Invitation'))

export const AuditLogSchema = registry.register('AuditLog', z.object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    actorId: UuidSchema,
    action: z.enum([
        'MEMBER_ROLE_CHANGED', 'MEMBER_LEFT',
        'INVITE_SENT', 'INVITE_ACCEPTED', 'INVITE_REVOKED',
        'OWNERSHIP_TRANSFERRED',
    ]).openapi({ example: 'INVITE_SENT' }),
    targetId: z.string().nullable().openapi({ example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
    metadata: z.record(z.unknown()).nullable().openapi({ example: { role: 'ADMIN' } }),
    createdAt: z.string().datetime().openapi({ example: '2024-01-01T00:00:00.000Z' }),
    actor: z.object({
        id: UuidSchema,
        name: z.string().nullable(),
        email: z.string().email(),
    }).optional(),
}).openapi('AuditLog'))

// ── Common response schemas ───────────────────────────────────────────────────

export const ErrorSchema = registry.register('Error', z.object({
    error: z.object({
        code: z.string().openapi({ example: 'UNAUTHORIZED' }),
        message: z.string().openapi({ example: 'Invalid or expired token' }),
    }),
}).openapi('Error'))

export const PaginationParamsSchema = {
    limit: { name: 'limit', in: 'query' as const, schema: { type: 'integer' as const, default: 20, minimum: 1, maximum: 100 }, description: 'Max items per page' },
    cursor: { name: 'cursor', in: 'query' as const, schema: { type: 'string' }, required: false, description: 'ID of the last item from the previous page' },
}

// Shared bearer security requirement
export const bearerAuth = [{ bearerAuth: [] }]

// Shared error responses
export const unauthorizedResponse = { description: 'Missing or invalid access token', content: { 'application/json': { schema: ErrorSchema } } }
export const forbiddenResponse = { description: 'Insufficient permissions', content: { 'application/json': { schema: ErrorSchema } } }
export const notFoundResponse = { description: 'Resource not found', content: { 'application/json': { schema: ErrorSchema } } }
export const conflictResponse = { description: 'Conflict (duplicate or constraint violation)', content: { 'application/json': { schema: ErrorSchema } } }
export const validationResponse = { description: 'Validation error (422)', content: { 'application/json': { schema: ErrorSchema } } }
