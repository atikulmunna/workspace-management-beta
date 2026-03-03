import jwt from 'jsonwebtoken'
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

// ── Refresh token (long-lived — 30d) ──────────────────────────────────────────
// Refresh tokens are NOT JWTs. They are 256-bit random hex strings, just like
// magic-link tokens. We store only the bcrypt hash in the DB.
// The raw token is returned to the client once and never stored plain.
import crypto from 'crypto'
import bcrypt from 'bcrypt'

const REFRESH_TOKEN_BYTES = 32
const REFRESH_TOKEN_RE = /^[0-9a-f]+$/

export function generateRefreshToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex')
}

export function isValidRefreshTokenFormat(raw: string): boolean {
  return raw.length === REFRESH_TOKEN_BYTES * 2 && REFRESH_TOKEN_RE.test(raw)
}

export async function hashRefreshToken(raw: string): Promise<string> {
  return bcrypt.hash(raw, 10)
}

export async function compareRefreshToken(raw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(raw, hash)
}
