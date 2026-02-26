import { prisma } from './prisma'

/**
 * Deletes expired and used magic link tokens.
 * Call this on a schedule (e.g. every hour) to keep the table lean.
 *
 * Usage in index.ts:
 *   import { startTokenCleanup } from './lib/cleanup'
 *   startTokenCleanup()
 */
export async function cleanupExpiredTokens(): Promise<void> {
  const { count } = await prisma.magicLinkToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },  // expired
        { usedAt: { not: null } },           // already used
      ],
    },
  })

  if (count > 0) {
    console.log(`[cleanup] Removed ${count} expired/used magic link token(s)`)
  }
}

export function startTokenCleanup(intervalMs = 60 * 60 * 1000): void {
  // Run immediately on startup, then on interval
  cleanupExpiredTokens().catch(console.error)
  setInterval(() => cleanupExpiredTokens().catch(console.error), intervalMs)
}
