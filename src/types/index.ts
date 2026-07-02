import { User, Membership, Role } from '@prisma/client'

// Shape of our own JWT payload
export interface JwtPayload {
  sub: string   // User.id (our internal UUID)
  email: string
  iat: number
  exp: number
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      currentUser?: User
      currentMembership?: Membership
      // Verified JWT payload, set by validateToken and read by syncUser.
      jwtPayload?: JwtPayload
    }
  }
}

export type { User, Membership, Role }
