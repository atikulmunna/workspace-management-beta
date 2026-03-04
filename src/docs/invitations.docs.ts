import { z } from 'zod'
import { registry } from '../lib/openapi'
import {
    InvitationSchema, MembershipSchema, WorkspaceSchema,
    bearerAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse, conflictResponse, validationResponse,
} from './schemas'

// ── GET /workspaces/:slug/invitations ─────────────────────────────────────────
registry.registerPath({
    method: 'get', path: '/workspaces/{slug}/invitations', tags: ['Invitations'],
    summary: 'List pending invitations',
    description: 'Returns pending invitations for a workspace, cursor-paginated. Requires ADMIN or above.',
    security: bearerAuth,
    request: { params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }) },
    responses: {
        200: {
            description: 'Invitation list', content: {
                'application/json': {
                    schema: z.object({
                        invitations: z.array(InvitationSchema),
                        nextCursor: z.string().nullable(),
                    })
                }
            }
        },
        401: unauthorizedResponse,
        403: forbiddenResponse,
    },
})

// ── POST /workspaces/:slug/invitations ────────────────────────────────────────
registry.registerPath({
    method: 'post', path: '/workspaces/{slug}/invitations', tags: ['Invitations'],
    summary: 'Send an invitation',
    description: [
        'Invites a user by email to join the workspace.',
        '**Requires ADMIN or above and a verified email address.**',
        '- Returns 409 if the email already belongs to a workspace member.',
        '- Returns 409 if a pending invitation already exists for that email.',
    ].join('\n'),
    security: bearerAuth,
    request: {
        params: z.object({ slug: z.string().openapi({ example: 'acme-corp' }) }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        email: z.string().email().openapi({ example: 'bob@example.com' }),
                        role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER').openapi({ example: 'MEMBER' }),
                    })
                }
            }
        },
    },
    responses: {
        201: { description: 'Invitation created & email sent', content: { 'application/json': { schema: z.object({ invitation: InvitationSchema }) } } },
        401: unauthorizedResponse,
        403: { description: 'Email not verified or insufficient permissions', content: { 'application/json': { schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }) } } },
        409: conflictResponse,
        422: validationResponse,
    },
})

// ── DELETE /workspaces/:slug/invitations/:invitationId ────────────────────────
registry.registerPath({
    method: 'delete', path: '/workspaces/{slug}/invitations/{invitationId}', tags: ['Invitations'],
    summary: 'Revoke an invitation',
    description: 'Revokes a pending invitation. Requires ADMIN or above. Returns 409 if already accepted/expired.',
    security: bearerAuth,
    request: {
        params: z.object({
            slug: z.string().openapi({ example: 'acme-corp' }),
            invitationId: z.string().uuid(),
        }),
    },
    responses: {
        204: { description: 'Invitation revoked' },
        401: unauthorizedResponse,
        403: forbiddenResponse,
        404: notFoundResponse,
        409: conflictResponse,
    },
})

// ── POST /invitations/:id/accept ──────────────────────────────────────────────
registry.registerPath({
    method: 'post', path: '/invitations/{id}/accept', tags: ['Invitations'],
    summary: 'Accept an invitation',
    description: [
        'Accepts an invitation and creates a workspace membership for the authenticated user.',
        '- The caller\'s email must match the invitation email.',
        '- Returns 403 if the invitation is expired, already used, or email mismatch.',
    ].join('\n'),
    security: bearerAuth,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        201: {
            description: 'Membership created', content: {
                'application/json': {
                    schema: z.object({
                        membership: MembershipSchema,
                        workspace: WorkspaceSchema,
                    })
                }
            }
        },
        401: unauthorizedResponse,
        403: forbiddenResponse,
        404: notFoundResponse,
    },
})
