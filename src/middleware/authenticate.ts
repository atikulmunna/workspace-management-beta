import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { prisma } from '../lib/prisma'
import { UnauthorizedError } from '../lib/errors'
import { JwtPayload } from '../types'

// Step 1 — Verify our own JWT (replaces Auth0 / express-jwt)
export const validateToken = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header')
    }

    const token = authHeader.slice(7)

    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload

    // Attach raw payload so syncUser can read it
    ;(req as any)._jwtPayload = payload

    next()
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Invalid or expired token'))
    } else {
      next(err)
    }
  }
}

// Step 2 — Load user from DB using the JWT sub (our User.id)
export const syncUser = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const payload = (req as any)._jwtPayload as JwtPayload
    if (!payload?.sub) throw new UnauthorizedError()

    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) throw new UnauthorizedError('User not found')

    req.currentUser = user
    next()
  } catch (err) {
    next(err)
  }
}

// Combine into a single reusable middleware array
export const authenticate = [validateToken, syncUser]
