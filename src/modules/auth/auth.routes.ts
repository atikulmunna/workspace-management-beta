import { Router, Request, Response } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import rateLimit from 'express-rate-limit'
import { prisma } from '../../lib/prisma'
import { sendMagicLinkEmail } from '../../lib/email'
import { signToken } from '../../lib/jwt'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { ValidationError, UnauthorizedError } from '../../lib/errors'
import { StatusCodes } from 'http-status-codes'

const router = Router()

const BCRYPT_ROUNDS = 10
const TOKEN_BYTES = 32  // 256 bits of entropy
const TOKEN_HEX_LENGTH = TOKEN_BYTES * 2  // hex encoding doubles the byte count
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
// User submits their email → we generate a token, store its hash, and
// email them a sign-in link. Always returns 200 to prevent email enumeration.
router.post('/magic-link', magicLinkLimiter, async (req: Request, res: Response) => {
  const { email, name } = requestSchema.parse(req.body)

  // JIT: create user if they don't exist yet
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: name ?? null },
  })

  // Invalidate any previous unused tokens for this user (one active link at a time)
  await prisma.magicLinkToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  // Cryptographically secure raw token (never stored)
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex')

  // Store only the bcrypt hash — DB leak cannot expose valid tokens
  const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS)

  await prisma.magicLinkToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + config.magicLink.expiresMinutes * 60 * 1000),
    },
  })

  // Fire-and-forget — a broken SMTP config won't fail the request
  sendMagicLinkEmail({ to: email, token: rawToken }).catch(console.error)

  // Always return 200 regardless of whether the email exists to
  // prevent attackers from enumerating registered emails
  res.status(StatusCodes.OK).json({
    message: `If an account exists for ${email}, a sign-in link has been sent.`,
  })
})

// ── GET /auth/verify?token=xxx ────────────────────────────────────────────────
// User clicks the magic link → validate token hash, issue JWT, consume token.
router.get('/verify', verifyLimiter, async (req: Request, res: Response) => {
  const rawToken = req.query.token as string | undefined
  if (!rawToken) throw new ValidationError('Missing token query parameter')

  // Fast-reject obviously invalid tokens before hitting the DB.
  // A valid token is exactly 64 lowercase hex chars (32 bytes hex-encoded).
  // This eliminates brute-force probes and malformed inputs with zero DB cost.
  if (rawToken.length !== TOKEN_HEX_LENGTH || !VALID_TOKEN_RE.test(rawToken)) {
    throw new UnauthorizedError('Invalid, expired, or already used sign-in link')
  }

  // Fetch all unexpired, unused tokens. AUTH-04 guarantees at most one active
  // token per user, so this set is bounded by the number of users who requested
  // a link in the last 15 min — tiny in practice. The take: 100 is a safety cap.
  // Future improvement: add a tokenPrefix column to scope this to O(1) lookups.
  const candidates = await prisma.magicLinkToken.findMany({
    where: {
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // bcrypt.compare finds the matching hash
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

  // Consume the token — one-time use only
  await prisma.magicLinkToken.update({
    where: { id: matched.id },
    data: { usedAt: new Date() },
  })

  // Issue our own signed JWT
  const accessToken = signToken(matched.user.id, matched.user.email)

  res.status(StatusCodes.OK).json({
    accessToken,
    user: {
      id: matched.user.id,
      email: matched.user.email,
      name: matched.user.name,
      avatarUrl: matched.user.avatarUrl,
    },
  })
})

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({ user: req.currentUser })
})

// ── PATCH /auth/me ────────────────────────────────────────────────────────────
// Update the current user's display name or avatar URL.
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
