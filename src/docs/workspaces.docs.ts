import { z } from 'zod'
import { registry } from '../lib/openapi'
import {
    WorkspaceSchema, MembershipSchema, AuditLogSchema, UuidSchema,
    PaginationParamsSchema, bearerAuth,
    unauthorizedResponse, forbiddenResponse, notFoundResponse, conflictResponse, validationResponse,
} from './schemas'

const slugParam = { name: 'slug', in: 'path' as const, required: true, schema: { type: 'string' as const }, description: 'Workspace slug', example: 'acme-corp' }

// ── POST /workspaces ──────────────────────────────────────────────────────────
registry.registerPath({
    method: 'post', path: '/workspaces', tags: ['Workspaces'],
    summary: 'Create a workspace',
    description: 'Creates a new workspace. The caller becomes its OWNER. **Requires verified email.**',
    security: bearerAuth,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().min(2).max(64).openapi({ example: 'Acme Corp' }),
                        description: z.string().max(256).optional().openapi({ example: 'Our main product workspace' }),
                        slug: z.string().min(2).max(64).optional().openapi({ example: 'acme-corp', description: 'Auto-generated from name if omitted' }),
                    })
                }
            }
        },
    },
    responses: {
        201: { description: 'Workspace created', content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } } },
        401: unauthorizedResponse,
        403: { description: 'Email not verified or insufficient permissions', content: { 'application/json': { schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }) } } },
        409: conflictResponse,
        422: validationResponse,
    },
})

// ── GET /workspaces ───────────────────────────────────────────────────────────
registry.registerPath({
    method: 'get', path: '/workspaces', tags: ['Workspaces'],
    summary: 'List workspaces',
    description: 'Returns all workspaces the authenticated user belongs to, cursor-paginated.',
    security: bearerAuth,
    request: { params: z.object({ limit: z.string().optional(), cursor: z.string().optional() }) },
    responses: {
        200: {
            description: 'Paginated workspace list',
            content: {
                'application/json': {
                    schema: z.object({
                        workspaces: z.array(WorkspaceSchema.extend({ role: z.string(), joinedAt: z.string() })),
                        nextCursor: z.string().nullable(),
                    })
                }
            },
        },
        401: unauthorizedResponse,
    },
})

// ── GET /workspaces/:slug ─────────────────────────────────────────────────────
registry.registerPath({
    method: 'get', path: '/workspaces/{slug}', tags: ['Workspaces'],
    summary: 'Get a workspace',
    security: bearerAuth,
    request: { params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }) },
    responses: {
        200: { description: 'Workspace details', content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } } },
        401: unauthorizedResponse,
        403: forbiddenResponse,
        404: notFoundResponse,
    },
})

// ── PATCH /workspaces/:slug ───────────────────────────────────────────────────
registry.registerPath({
    method: 'patch', path: '/workspaces/{slug}', tags: ['Workspaces'],
    summary: 'Update workspace',
    description: 'Update name or description. Requires ADMIN or above.',
    security: bearerAuth,
    request: {
        params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().min(2).max(64).optional().openapi({ example: 'Acme Enterprise' }),
                        description: z.string().max(256).optional(),
                    })
                }
            }
        },
    },
    responses: {
        200: { description: 'Updated workspace', content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } } },
        401: unauthorizedResponse,
        403: forbiddenResponse,
        422: validationResponse,
    },
})

// ── DELETE /workspaces/:slug ──────────────────────────────────────────────────
registry.registerPath({
    method: 'delete', path: '/workspaces/{slug}', tags: ['Workspaces'],
    summary: 'Delete workspace',
    description: 'Permanently deletes a workspace and all its data. OWNER only.',
    security: bearerAuth,
    request: { params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }) },
    responses: {
        204: { description: 'Workspace deleted' },
        401: unauthorizedResponse,
        403: forbiddenResponse,
    },
})

// ── PATCH /workspaces/:slug/transfer-owner ────────────────────────────────────
registry.registerPath({
    method: 'patch', path: '/workspaces/{slug}/transfer-owner', tags: ['Workspaces'],
    summary: 'Transfer ownership',
    description: 'Atomically demotes the current OWNER to ADMIN and promotes the target member to OWNER. OWNER only.',
    security: bearerAuth,
    request: {
        params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        userId: UuidSchema.openapi({ description: 'UUID of the member to promote to OWNER' }),
                    })
                }
            }
        },
    },
    responses: {
        200: {
            description: 'Ownership transferred', content: {
                'application/json': {
                    schema: z.object({
                        message: z.string(),
                        newOwner: MembershipSchema,
                        prevOwner: MembershipSchema,
                    })
                }
            }
        },
        401: unauthorizedResponse,
        403: forbiddenResponse,
        404: notFoundResponse,
        422: validationResponse,
    },
})

// ── GET /workspaces/:slug/audit-logs ──────────────────────────────────────────
registry.registerPath({
    method: 'get', path: '/workspaces/{slug}/audit-logs', tags: ['Audit'],
    summary: 'Get audit log',
    description: 'Returns workspace audit events, newest first. Requires ADMIN or above. Cursor-paginated.',
    security: bearerAuth,
    request: { params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }) },
    responses: {
        200: {
            description: 'Audit log entries', content: {
                'application/json': {
                    schema: z.object({
                        logs: z.array(AuditLogSchema),
                        nextCursor: z.string().nullable(),
                    })
                }
            }
        },
        401: unauthorizedResponse,
        403: forbiddenResponse,
    },
})
