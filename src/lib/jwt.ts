import jwt from 'jsonwebtoken'
import { config } from '../config'
import { JwtPayload } from '../types'

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
