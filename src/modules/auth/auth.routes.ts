import { Router, Request, Response } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { prisma } from '../../lib/prisma'
import { sendMagicLinkEmail } from '../../lib/email'
import {
  signToken,
  generateToken,
  hashToken,
  isValidTokenFormat,
} from '../../lib/jwt'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { ValidationError, UnauthorizedError, ConflictError } from '../../lib/errors'
import { StatusCodes } from 'http-status-codes'

const router = Router()

const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in requests. Please wait 15 minutes.' } },
})

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many verification attempts. Please wait 15 minutes.' } },
})

const requestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
})

// ── POST /auth/magic-link ─────────────────────────────────────────────────────
router.post('/magic-link', magicLinkLimiter, async (req: Request, res: Response) => {
  const { email, name } = requestSchema.parse(req.body)

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: name ?? null },
  })

  await prisma.magicLinkToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)

  await prisma.magicLinkToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + config.magicLink.expiresMinutes * 60 * 1000),
    },
  })

  sendMagicLinkEmail({ to: email, token: rawToken }).catch(console.error)

  res.status(StatusCodes.OK).json({
    message: `If an account exists for ${email}, a sign-in link has been sent.`,
  })
})

// ── GET /auth/verify?token=xxx ────────────────────────────────────────────────
// Side-effect-free: validates the token's FORMAT only and echoes it back. It
// never touches the DB and never consumes the token, so email-scanner/link-preview
// prefetch (which issues GETs) cannot burn a single-use sign-in link. The client
// completes sign-in by POSTing the token to POST /auth/verify.
router.get('/verify', verifyLimiter, (req: Request, res: Response) => {
  const rawToken = req.query.token as string | undefined
  if (!rawToken) throw new ValidationError('Missing token query parameter')

  if (!isValidTokenFormat(rawToken)) {
    throw new UnauthorizedError('Invalid, expired, or already used sign-in link')
  }

  res.status(StatusCodes.OK).json({
    token: rawToken,
    message: 'Submit this token via POST /auth/verify to complete sign-in.',
  })
})

// ── POST /auth/verify ─────────────────────────────────────────────────────────
// Consumes the magic-link token (single-use) and issues the access/refresh pair.
// Sets emailVerifiedAt on first successful verification.
const verifyBodySchema = z.object({ token: z.string() })

router.post('/verify', verifyLimiter, async (req: Request, res: Response) => {
  const { token: rawToken } = verifyBodySchema.parse(req.body)

  if (!isValidTokenFormat(rawToken)) {
    throw new UnauthorizedError('Invalid, expired, or already used sign-in link')
  }

  // O(1) indexed lookup on the deterministic hash — no row scan, no per-row hashing.
  const matched = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  })

  if (!matched || matched.usedAt || matched.expiresAt <= new Date()) {
    throw new UnauthorizedError('Invalid, expired, or already used sign-in link')
  }

  // Mark token as used + set emailVerifiedAt on first verification
  const now = new Date()
  await prisma.magicLinkToken.update({
    where: { id: matched.id },
    data: { usedAt: now },
  })

  // Set emailVerifiedAt only on first-ever verification
  if (!matched.user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: matched.user.id },
      data: { emailVerifiedAt: now },
    })
    matched.user.emailVerifiedAt = now
  }

  // Revoke existing refresh tokens, issue new pair
  await prisma.refreshToken.updateMany({
    where: { userId: matched.user.id, revokedAt: null },
    data: { revokedAt: now },
  })

  const rawRefresh = generateToken()
  const refreshHash = hashToken(rawRefresh)
  await prisma.refreshToken.create({
    data: {
      userId: matched.user.id,
      tokenHash: refreshHash,
      expiresAt: new Date(now.getTime() + config.refreshToken.expiresInDays * 24 * 60 * 60 * 1000),
    },
  })

  const accessToken = signToken(matched.user.id, matched.user.email)

  res.status(StatusCodes.OK).json({
    accessToken,
    refreshToken: rawRefresh,
    user: {
      id: matched.user.id,
      email: matched.user.email,
      name: matched.user.name,
      avatarUrl: matched.user.avatarUrl,
      emailVerifiedAt: matched.user.emailVerifiedAt,
    },
  })
})

// ── POST /auth/refresh ────────────────────────────────────────────────────────
const refreshSchema = z.object({ refreshToken: z.string() })

router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken: rawRefresh } = refreshSchema.parse(req.body)

  if (!isValidTokenFormat(rawRefresh)) {
    throw new UnauthorizedError('Invalid refresh token')
  }

  // O(1) indexed lookup on the deterministic hash.
  const matched = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawRefresh) },
    include: { user: true },
  })

  if (!matched || matched.revokedAt || matched.expiresAt <= new Date()) {
    throw new UnauthorizedError('Invalid, expired, or revoked refresh token')
  }

  const newRawRefresh = generateToken()
  const newRefreshHash = hashToken(newRawRefresh)
  const expiresAt = new Date(Date.now() + config.refreshToken.expiresInDays * 24 * 60 * 60 * 1000)

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: matched.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({ data: { userId: matched.user.id, tokenHash: newRefreshHash, expiresAt } }),
  ])

  const accessToken = signToken(matched.user.id, matched.user.email)

  res.status(StatusCodes.OK).json({ accessToken, refreshToken: newRawRefresh })
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────
const logoutSchema = z.object({ refreshToken: z.string() })

router.post('/logout', authenticate, async (req: Request, res: Response) => {
  const { refreshToken: rawRefresh } = logoutSchema.parse(req.body)

  if (isValidTokenFormat(rawRefresh)) {
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawRefresh) },
    })
    // Only revoke a live token that actually belongs to the caller.
    if (token && token.userId === req.currentUser!.id && !token.revokedAt) {
      await prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } })
    }
  }

  res.status(StatusCodes.NO_CONTENT).send()
})

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({ user: req.currentUser })
})

// ── PATCH /auth/me ────────────────────────────────────────────────────────────
const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().max(2048).optional(),
}).refine(
  (data) => data.name !== undefined || data.avatarUrl !== undefined,
  { message: 'At least one field (name, avatarUrl) must be provided' }
)

router.patch('/me', authenticate, async (req: Request, res: Response) => {
  const body = updateProfileSchema.parse(req.body)
  const updated = await prisma.user.update({
    where: { id: req.currentUser!.id },
    data: body,
  })
  res.json({ user: updated })
})

// ── DELETE /auth/me ───────────────────────────────────────────────────────────
// Deletes the authenticated user's account.
// Blocked (409) if the user is the sole OWNER of any workspace.
router.delete('/me', authenticate, async (req: Request, res: Response) => {
  const userId = req.currentUser!.id

  // Find workspaces where this user is OWNER
  const ownedMemberships = await prisma.membership.findMany({
    where: { userId, role: 'OWNER' },
    include: { workspace: true },
  })

  // For each owned workspace, check if there are other members who could take over
  const blockedWorkspaces: string[] = []
  for (const mem of ownedMemberships) {
    const otherMemberCount = await prisma.membership.count({
      where: { workspaceId: mem.workspaceId, userId: { not: userId } },
    })
    // Sole occupant OR no other member to transfer to
    if (otherMemberCount === 0) {
      blockedWorkspaces.push(mem.workspace.slug)
    }
  }

  if (blockedWorkspaces.length > 0) {
    throw new ConflictError(
      `You are the sole owner of: ${blockedWorkspaces.join(', ')}. ` +
      `Transfer ownership or delete these workspaces before deleting your account.`
    )
  }

  // Cascade: Prisma schema has onDelete: Cascade on memberships, tokens etc.
  // Revoke pending invitations sent by this user before cascade delete.
  await prisma.invitation.updateMany({
    where: { invitedById: userId, status: 'PENDING' },
    data: { status: 'REVOKED' },
  })

  await prisma.user.delete({ where: { id: userId } })

  res.status(StatusCodes.NO_CONTENT).send()
})

export default router
