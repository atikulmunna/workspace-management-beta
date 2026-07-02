import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { config } from '../config'
import { JwtPayload } from '../types'

// ── Access token (short-lived) ─────────────────────────────────────────────────
export function signToken(userId: string, email: string): string {
  return jwt.sign(
    { sub: userId, email } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn } as jwt.SignOptions
  )
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as JwtPayload
}

// ── Opaque tokens (magic-link + refresh) ────────────────────────────────────────
// Neither is a JWT. They are 256-bit random hex strings. We store only a
// deterministic SHA-256 hash in the DB and return the raw token to the client once.
//
// Why SHA-256 and not bcrypt: bcrypt is deliberately slow to protect *low-entropy*
// passwords against brute force. These tokens are already 256 bits of CSPRNG output,
// so brute force is infeasible regardless of hash speed. A fast deterministic hash
// lets us do a single indexed `findUnique({ where: { tokenHash } })` lookup — O(1) —
// instead of scanning rows and bcrypt-comparing each (O(N), a DoS vector). A DB leak
// still exposes only the hash, which is not reversible to a usable token.

const TOKEN_BYTES = 32
const TOKEN_HEX_RE = /^[0-9a-f]+$/

export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex')
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export function isValidTokenFormat(raw: string): boolean {
  return raw.length === TOKEN_BYTES * 2 && TOKEN_HEX_RE.test(raw)
}
