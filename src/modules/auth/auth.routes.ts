import { Router, Request, Response } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import rateLimit from 'express-rate-limit'
import { prisma } from '../../lib/prisma'
import { sendMagicLinkEmail } from '../../lib/email'
import {
  signToken,
  generateRefreshToken,
  hashRefreshToken,
  compareRefreshToken,
  isValidRefreshTokenFormat,
} from '../../lib/jwt'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { ValidationError, UnauthorizedError } from '../../lib/errors'
import { StatusCodes } from 'http-status-codes'

const router = Router()

const BCRYPT_ROUNDS = 10
const TOKEN_BYTES = 32
const TOKEN_HEX_LENGTH = TOKEN_BYTES * 2
const VALID_TOKEN_RE = /^[0-9a-f]+$/

// SEC-09: max 5 magic-link requests per IP per 15 minutes
const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in requests. Please wait 15 minutes.' } },
})

// SEC-10: max 10 verify attempts per IP per 15 minutes
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

  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS)

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
// On success: issues a short-lived access token (15m) + rotating refresh token (30d).
router.get('/verify', verifyLimiter, async (req: Request, res: Response) => {
  const rawToken = req.query.token as string | undefined
  if (!rawToken) throw new ValidationError('Missing token query parameter')

  if (rawToken.length !== TOKEN_HEX_LENGTH || !VALID_TOKEN_RE.test(rawToken)) {
    throw new UnauthorizedError('Invalid, expired, or already used sign-in link')
  }

  const candidates = await prisma.magicLinkToken.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  let matched: (typeof candidates)[0] | null = null
  for (const candidate of candidates) {
    if (await bcrypt.compare(rawToken, candidate.tokenHash)) {
      matched = candidate
      break
    }
  }

  if (!matched) {
    throw new UnauthorizedError('Invalid, expired, or already used sign-in link')
  }

  // Consume magic-link token
  await prisma.magicLinkToken.update({
    where: { id: matched.id },
    data: { usedAt: new Date() },
  })

  // Revoke any existing active refresh tokens for this user (one session at a time)
  await prisma.refreshToken.updateMany({
    where: { userId: matched.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  // Issue new refresh token
  const rawRefresh = generateRefreshToken()
  const refreshHash = await hashRefreshToken(rawRefresh)
  await prisma.refreshToken.create({
    data: {
      userId: matched.user.id,
      tokenHash: refreshHash,
      expiresAt: new Date(Date.now() + config.refreshToken.expiresInDays * 24 * 60 * 60 * 1000),
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
    },
  })
})

// ── POST /auth/refresh ────────────────────────────────────────────────────────
// Client sends their refresh token → gets back a new access + refresh pair.
// Old refresh token is revoked immediately (rotation).
const refreshSchema = z.object({
  refreshToken: z.string(),
})

router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken: rawRefresh } = refreshSchema.parse(req.body)

  // Fast-reject malformed tokens before hitting DB
  if (!isValidRefreshTokenFormat(rawRefresh)) {
    throw new UnauthorizedError('Invalid refresh token')
  }

  // Find active, unexpired token records — bounded by the take cap
  const candidates = await prisma.refreshToken.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  let matched: (typeof candidates)[0] | null = null
  for (const c of candidates) {
    if (await compareRefreshToken(rawRefresh, c.tokenHash)) {
      matched = c
      break
    }
  }

  if (!matched) {
    throw new UnauthorizedError('Invalid, expired, or revoked refresh token')
  }

  // Rotate: revoke old token, issue new pair atomically
  const newRawRefresh = generateRefreshToken()
  const newRefreshHash = await hashRefreshToken(newRawRefresh)
  const expiresAt = new Date(Date.now() + config.refreshToken.expiresInDays * 24 * 60 * 60 * 1000)

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: matched.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: { userId: matched.user.id, tokenHash: newRefreshHash, expiresAt },
    }),
  ])

  const accessToken = signToken(matched.user.id, matched.user.email)

  res.status(StatusCodes.OK).json({
    accessToken,
    refreshToken: newRawRefresh,
  })
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────
// Revokes the user's active refresh token. Client should discard stored tokens.
const logoutSchema = z.object({
  refreshToken: z.string(),
})

router.post('/logout', authenticate, async (req: Request, res: Response) => {
  const { refreshToken: rawRefresh } = logoutSchema.parse(req.body)

  if (!isValidRefreshTokenFormat(rawRefresh)) {
    // Be silent — don't reveal whether the token was valid
    return res.status(StatusCodes.NO_CONTENT).send()
  }

  const candidates = await prisma.refreshToken.findMany({
    where: { userId: req.currentUser!.id, revokedAt: null },
    take: 5,  // a user should never have more than a handful of active tokens
  })

  for (const c of candidates) {
    if (await compareRefreshToken(rawRefresh, c.tokenHash)) {
      await prisma.refreshToken.update({
        where: { id: c.id },
        data: { revokedAt: new Date() },
      })
      break
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

export default router
