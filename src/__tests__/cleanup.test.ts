jest.mock('../lib/prisma', () => ({
    prisma: {
        magicLinkToken: { deleteMany: jest.fn() },
        refreshToken: { deleteMany: jest.fn() },
    },
}))

import { cleanupExpiredTokens } from '../lib/cleanup'
import { prisma } from '../lib/prisma'

const db = prisma as any

describe('cleanupExpiredTokens', () => {
    beforeEach(() => {
        db.magicLinkToken.deleteMany.mockResolvedValue({ count: 0 })
        db.refreshToken.deleteMany.mockResolvedValue({ count: 0 })
    })

    it('sweeps expired/used magic-link tokens', async () => {
        await cleanupExpiredTokens()

        expect(db.magicLinkToken.deleteMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { expiresAt: { lt: expect.any(Date) } },
                    { usedAt: { not: null } },
                ],
            },
        })
    })

    it('also sweeps expired/revoked refresh tokens', async () => {
        db.refreshToken.deleteMany.mockResolvedValue({ count: 3 })

        await cleanupExpiredTokens()

        expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { expiresAt: { lt: expect.any(Date) } },
                    { revokedAt: { not: null } },
                ],
            },
        })
    })
})
