import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { Role } from '@prisma/client'
import { authenticate } from '../../middleware/authenticate'
import { requireWorkspaceMember, requireRole } from '../../middleware/authorize'
import { prisma } from '../../lib/prisma'
import { ForbiddenError, NotFoundError } from '../../lib/errors'
import { StatusCodes } from 'http-status-codes'

// Must match the hierarchy in middleware/authorize.ts
const ROLE_HIERARCHY: Role[] = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER']

const router = Router({ mergeParams: true }) // inherit :slug from parent

router.use(authenticate)
router.use(requireWorkspaceMember)

const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']), // OWNER is not assignable via API
})

/**
 * GET /workspaces/:slug/members
 * List all members of a workspace.
 */
router.get('/', async (req: Request, res: Response) => {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: req.params.slug },
  })
  if (!workspace) throw new NotFoundError('Workspace')

  const members = await prisma.membership.findMany({
    where: { workspaceId: workspace.id },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { joinedAt: 'asc' },
  })

  res.json({ members })
})

/**
 * PATCH /workspaces/:slug/members/:userId
 * Update a member's role. ADMIN+ only. Cannot change OWNER role.
 */
router.patch(
  '/:userId',
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const { role } = updateRoleSchema.parse(req.body)
    const { userId } = req.params

    const workspace = await prisma.workspace.findUnique({
      where: { slug: req.params.slug },
    })
    if (!workspace) throw new NotFoundError('Workspace')

    const targetMembership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
    })

    if (!targetMembership) throw new NotFoundError('Member')
    if (targetMembership.role === 'OWNER') {
      throw new ForbiddenError('Cannot change the role of the workspace owner')
    }

    // MEM-06: caller cannot elevate someone above their own role level.
    // e.g. ADMIN (index 2) cannot assign OWNER (index 3).
    // OWNER is already blocked by the Zod schema, but this guard is
    // future-proof in case the schema is ever loosened.
    const callerRoleIndex = ROLE_HIERARCHY.indexOf(req.currentMembership!.role)
    const newRoleIndex = ROLE_HIERARCHY.indexOf(role)
    if (newRoleIndex > callerRoleIndex) {
      throw new ForbiddenError('You cannot assign a role higher than your own')
    }

    const updated = await prisma.membership.update({
      where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    res.json({ membership: updated })
  }
)

/**
 * DELETE /workspaces/:slug/members/:userId
 * Remove a member. ADMIN+ can remove others. Anyone can remove themselves. Owner cannot be removed.
 */
router.delete(
  '/:userId',
  async (req: Request, res: Response) => {
    const { userId } = req.params
    const currentUser = req.currentUser!
    const currentMembership = req.currentMembership!

    const workspace = await prisma.workspace.findUnique({
      where: { slug: req.params.slug },
    })
    if (!workspace) throw new NotFoundError('Workspace')

    const targetMembership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
    })
    if (!targetMembership) throw new NotFoundError('Member')

    // Can't remove the owner
    if (targetMembership.role === 'OWNER') {
      throw new ForbiddenError('Cannot remove the workspace owner')
    }

    // Must be ADMIN+ to remove others, but anyone can remove themselves
    const isSelf = userId === currentUser.id
    const isAdminOrAbove = ['ADMIN', 'OWNER'].includes(currentMembership.role)

    if (!isSelf && !isAdminOrAbove) {
      throw new ForbiddenError('Insufficient permissions to remove this member')
    }

    await prisma.membership.delete({
      where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
    })

    res.status(StatusCodes.NO_CONTENT).send()
  }
)

export default router
