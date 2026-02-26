import { Request, Response, NextFunction } from 'express'
import { Role } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors'

// Role hierarchy — higher index = more permissions
const ROLE_HIERARCHY: Role[] = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER']

function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(requiredRole)
}

// Attach the user's membership for the requested workspace to req.currentMembership
// Expects :slug or :workspaceId in route params
export const requireWorkspaceMember = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    if (!req.currentUser) throw new UnauthorizedError()

    const slug = req.params.slug
    const workspaceId = req.params.workspaceId

    // Find workspace by slug or id
    const workspace = await prisma.workspace.findFirst({
      where: slug ? { slug } : { id: workspaceId },
    })

    if (!workspace) throw new NotFoundError('Workspace')

    const membership = await prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: req.currentUser.id,
          workspaceId: workspace.id,
        },
      },
    })

    if (!membership) throw new ForbiddenError('You are not a member of this workspace')

    req.currentMembership = membership
    next()
  } catch (err) {
    next(err)
  }
}

// Factory — require a minimum role to proceed
export const requireRole = (minimumRole: Role) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const membership = req.currentMembership
    if (!membership) throw new ForbiddenError()
    if (!hasMinimumRole(membership.role, minimumRole)) {
      throw new ForbiddenError(`Requires at least ${minimumRole} role`)
    }
    next()
  }
}
