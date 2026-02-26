import { User, Membership, Role } from '@prisma/client'

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      currentUser?: User
      currentMembership?: Membership
    }
  }
}

export type { User, Membership, Role }

// Shape of our own JWT payload
export interface JwtPayload {
  sub: string   // User.id (our internal UUID)
  email: string
  iat: number
  exp: number
}
