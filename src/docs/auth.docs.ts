import { z } from 'zod'
import { registry } from '../lib/openapi'
import {
    UserSchema, ErrorSchema,
    bearerAuth, unauthorizedResponse, forbiddenResponse, validationResponse,
} from './schemas'

const tokenResponse = z.object({
    accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiJ9...' }),
    refreshToken: z.string().openapi({ example: 'a3f8d1b624c0e9...(256-bit hex)' }),
    user: UserSchema,
})

// ── POST /auth/magic-link ─────────────────────────────────────────────────────
registry.registerPath({
    method: 'post', path: '/auth/magic-link', tags: ['Auth'],
    summary: 'Request a magic sign-in link',
    description: 'Sends a one-time sign-in link to the provided email. Always returns 200 to prevent email enumeration.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        email: z.string().email().openapi({ example: 'alice@example.com' }),
                        name: z.string().min(1).max(100).optional().openapi({ example: 'Alice' }),
                    })
                }
            }
        },
    },
    responses: {
        200: { description: 'Link sent (or silently ignored if email not found)', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
        422: validationResponse,
        429: { description: 'Rate limit exceeded (5 requests / 15 min per IP)' },
    },
})

// ── GET /auth/verify ──────────────────────────────────────────────────────────
registry.registerPath({
    method: 'get', path: '/auth/verify', tags: ['Auth'],
    summary: 'Consume a magic link and receive tokens',
    description: 'Validates the one-time token from the email link. Sets `emailVerifiedAt` on first use. Returns a short-lived access token (15 min) and a rotating refresh token (30 days).',
    request: { params: z.object({ token: z.string().openapi({ description: 'The token from the magic link query string' }) }) },
    responses: {
        200: { description: 'Tokens issued', content: { 'application/json': { schema: tokenResponse } } },
        401: unauthorizedResponse,
        422: validationResponse,
    },
})

// ── POST /auth/refresh ────────────────────────────────────────────────────────
registry.registerPath({
    method: 'post', path: '/auth/refresh', tags: ['Auth'],
    summary: 'Rotate refresh token → new token pair',
    description: 'Validates the current refresh token and atomically issues a new access + refresh pair. The old refresh token is immediately revoked.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        refreshToken: z.string().openapi({ example: 'a3f8d1b624c0e9...' }),
                    })
                }
            }
        },
    },
    responses: {
        200: { description: 'New token pair', content: { 'application/json': { schema: z.object({ accessToken: z.string(), refreshToken: z.string() }) } } },
        401: unauthorizedResponse,
    },
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────
registry.registerPath({
    method: 'post', path: '/auth/logout', tags: ['Auth'],
    summary: 'Revoke current refresh token',
    description: 'Revokes the provided refresh token. Silently succeeds even if the token is invalid (no enumeration).',
    security: bearerAuth,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        refreshToken: z.string().openapi({ example: 'a3f8d1b624c0e9...' }),
                    })
                }
            }
        },
    },
    responses: {
        204: { description: 'Logged out — tokens should be discarded by client' },
        401: unauthorizedResponse,
    },
})

// ── GET /auth/me ──────────────────────────────────────────────────────────────
registry.registerPath({
    method: 'get', path: '/auth/me', tags: ['Auth'],
    summary: 'Get current user profile',
    security: bearerAuth,
    responses: {
        200: { description: 'Current user', content: { 'application/json': { schema: z.object({ user: UserSchema }) } } },
        401: unauthorizedResponse,
    },
})

// ── PATCH /auth/me ────────────────────────────────────────────────────────────
registry.registerPath({
    method: 'patch', path: '/auth/me', tags: ['Auth'],
    summary: 'Update user profile',
    description: 'Update `name` and/or `avatarUrl`. At least one field is required.',
    security: bearerAuth,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().min(1).max(100).optional().openapi({ example: 'Alice Liddell' }),
                        avatarUrl: z.string().url().optional().openapi({ example: 'https://example.com/photo.jpg' }),
                    })
                }
            }
        },
    },
    responses: {
        200: { description: 'Updated user', content: { 'application/json': { schema: z.object({ user: UserSchema }) } } },
        401: unauthorizedResponse,
        422: validationResponse,
    },
})

// ── DELETE /auth/me ───────────────────────────────────────────────────────────
registry.registerPath({
    method: 'delete', path: '/auth/me', tags: ['Auth'],
    summary: 'Delete account',
    description: 'Permanently deletes the authenticated user\'s account. Blocked (409) if the user is the **sole owner** of any workspace that has no other members. Revokes pending invitations sent by the user before deletion.',
    security: bearerAuth,
    responses: {
        204: { description: 'Account deleted' },
        401: unauthorizedResponse,
        409: { description: 'Sole owner of one or more workspaces', content: { 'application/json': { schema: ErrorSchema } } },
    },
})
