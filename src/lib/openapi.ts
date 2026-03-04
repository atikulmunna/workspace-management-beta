import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Must be called once globally BEFORE any .openapi() schema definitions are evaluated
extendZodWithOpenApi(z)

export const registry = new OpenAPIRegistry()

// ── Bearer token security scheme ──────────────────────────────────────────────
registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Short-lived access token (15 min). Obtain via GET /auth/verify.',
})

// ── Build the final OpenAPI 3.1 document ──────────────────────────────────────
export function generateSpec() {
    // Import registrations so side-effects (registry.registerPath etc.) run
    require('../docs/auth.docs')
    require('../docs/workspaces.docs')
    require('../docs/members.docs')
    require('../docs/invitations.docs')

    const generator = new OpenApiGeneratorV31(registry.definitions)
    return generator.generateDocument({
        openapi: '3.1.0',
        info: {
            title: 'Workspace Management API',
            version: '1.0.0',
            description: [
                'Multi-tenant workspace management service.',
                '',
                '**Authentication flow:**',
                '1. `POST /auth/magic-link` — request a sign-in link',
                '2. `GET  /auth/verify?token=…` — consume the link → receive `accessToken` + `refreshToken`',
                '3. Send `Authorization: Bearer <accessToken>` on every protected request',
                '4. When access token expires, call `POST /auth/refresh` to rotate both tokens',
            ].join('\n'),
            contact: { name: 'API Support', email: 'support@example.com' },
            license: { name: 'MIT' },
        },
        servers: [
            { url: 'http://localhost:3000', description: 'Local development' },
            { url: 'https://api.yourapp.com', description: 'Production' },
        ],
        tags: [
            { name: 'Auth', description: 'Authentication & account management' },
            { name: 'Workspaces', description: 'Workspace CRUD and settings' },
            { name: 'Members', description: 'Workspace membership management' },
            { name: 'Invitations', description: 'Invite external users to a workspace' },
            { name: 'Audit', description: 'Audit log for workspace events' },
        ],
    })
}
