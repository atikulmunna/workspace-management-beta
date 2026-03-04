import { z } from 'zod'
import { registry } from '../lib/openapi'
import {
    MembershipSchema, UuidSchema, RoleSchema,
    bearerAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationResponse,
} from './schemas'

// ── GET /workspaces/:slug/members ─────────────────────────────────────────────
registry.registerPath({
    method: 'get', path: '/workspaces/{slug}/members', tags: ['Members'],
    summary: 'List members',
    description: 'Returns all members of a workspace, cursor-paginated. Accessible to any workspace member.',
    security: bearerAuth,
    request: { params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }) },
    responses: {
        200: {
            description: 'Member list', content: {
                'application/json': {
                    schema: z.object({
                        members: z.array(MembershipSchema),
                        nextCursor: z.string().nullable(),
                    })
                }
            }
        },
        401: unauthorizedResponse,
        403: forbiddenResponse,
    },
})

// ── PATCH /workspaces/:slug/members/:userId ───────────────────────────────────
registry.registerPath({
    method: 'patch', path: '/workspaces/{slug}/members/{userId}', tags: ['Members'],
    summary: 'Update member role',
    description: [
        'Changes a member\'s role. Requires ADMIN or above.',
        '- Cannot change the OWNER\'s role.',
        '- Cannot assign a role higher than your own.',
        '- OWNER cannot be set via this endpoint (use `/transfer-owner`).',
    ].join('\n'),
    security: bearerAuth,
    request: {
        params: z.object({
            slug: z.string().openapi({ example: 'acme-corp' }),
            userId: UuidSchema,
        }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).openapi({ example: 'ADMIN' }),
                    })
                }
            }
        },
    },
    responses: {
        200: { description: 'Updated membership', content: { 'application/json': { schema: z.object({ membership: MembershipSchema }) } } },
        401: unauthorizedResponse,
        403: forbiddenResponse,
        404: notFoundResponse,
        422: validationResponse,
    },
})

// ── DELETE /workspaces/:slug/members/:userId ──────────────────────────────────
registry.registerPath({
    method: 'delete', path: '/workspaces/{slug}/members/{userId}', tags: ['Members'],
    summary: 'Remove a member',
    description: [
        'Removes a member from the workspace.',
        '- ADMIN+ can remove any non-owner member.',
        '- Any member can remove themselves (self-leave).',
        '- The OWNER cannot be removed.',
    ].join('\n'),
    security: bearerAuth,
    request: {
        params: z.object({
            slug: z.string().openapi({ example: 'acme-corp' }),
            userId: UuidSchema,
        }),
    },
    responses: {
        204: { description: 'Member removed' },
        401: unauthorizedResponse,
        403: forbiddenResponse,
        404: notFoundResponse,
    },
})
