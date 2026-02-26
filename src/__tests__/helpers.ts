import jwt from 'jsonwebtoken'

// Plain interfaces matching the Prisma-generated shapes — no prisma generate needed in tests
type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'

interface User { id: string; email: string; name: string | null; avatarUrl: string | null; createdAt: Date; updatedAt: Date }
interface Workspace { id: string; name: string; slug: string; description: string | null; createdAt: Date; updatedAt: Date }
interface Membership { id: string; userId: string; workspaceId: string; role: Role; joinedAt: Date }
interface Invitation { id: string; email: string; workspaceId: string; invitedById: string; role: Role; status: InvitationStatus; expiresAt: Date; createdAt: Date }


const JWT_SECRET = process.env.JWT_SECRET!

// ── Token factory ─────────────────────────────────────────────────────────────

/** Creates a valid signed JWT for use in Authorization: Bearer headers */
export function makeToken(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email }, JWT_SECRET, { expiresIn: '1h' })
}

// ── Data factories ────────────────────────────────────────────────────────────

export function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: 'user-uuid-1',
        email: 'alice@example.com',
        name: 'Alice',
        avatarUrl: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        ...overrides,
    }
}

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
    return {
        id: 'workspace-uuid-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        description: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        ...overrides,
    }
}

export function makeMembership(overrides: Partial<Membership> = {}): Membership {
    return {
        id: 'membership-uuid-1',
        userId: 'user-uuid-1',
        workspaceId: 'workspace-uuid-1',
        role: 'MEMBER' as Role,
        joinedAt: new Date('2024-01-01'),
        ...overrides,
    }
}

export function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
    return {
        id: 'invite-uuid-1',
        email: 'bob@example.com',
        workspaceId: 'workspace-uuid-1',
        invitedById: 'user-uuid-1',
        role: 'MEMBER' as Role,
        status: 'PENDING' as InvitationStatus,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date('2024-01-01'),
        ...overrides,
    }
}

export function makeMagicLinkToken(overrides: Record<string, unknown> = {}) {
    return {
        id: 'token-uuid-1',
        userId: 'user-uuid-1',
        tokenHash: '$2b$10$mockedhashvalue',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        usedAt: null,
        createdAt: new Date('2024-01-01'),
        user: makeUser(),
        ...overrides,
    }
}
