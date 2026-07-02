import { prisma } from './prisma'

/**
 * Deletes spent auth tokens so neither table grows unbounded:
 *   - magic-link tokens: expired OR already used
 *   - refresh tokens:    expired OR revoked (rotation revokes but never deletes)
 *
 * Call this on a schedule (e.g. every hour). Revoked refresh tokens are safe to
 * drop because this service does not implement refresh-token reuse detection.
 *
 * Usage in index.ts:
 *   import { startTokenCleanup } from './lib/cleanup'
 *   startTokenCleanup()
 */
export async function cleanupExpiredTokens(): Promise<void> {
  const now = new Date()

  const { count: magicLinkCount } = await prisma.magicLinkToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },  // expired
        { usedAt: { not: null } },   // already used
      ],
    },
  })

  const { count: refreshCount } = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },  // expired
        { revokedAt: { not: null } }, // rotated out / logged out
      ],
    },
  })

  if (magicLinkCount + refreshCount > 0) {
    console.log(
      `[cleanup] Removed ${magicLinkCount} magic-link + ${refreshCount} refresh token(s)`
    )
  }
}

export function startTokenCleanup(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  // Run immediately on startup, then on interval
  cleanupExpiredTokens().catch(console.error)
  const handle = setInterval(() => cleanupExpiredTokens().catch(console.error), intervalMs)
  // Don't let the cleanup timer alone keep the process alive during shutdown.
  handle.unref?.()
  return handle
}
