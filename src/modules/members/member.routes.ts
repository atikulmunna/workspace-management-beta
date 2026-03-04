import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { Role } from '@prisma/client'
import { authenticate } from '../../middleware/authenticate'
import { requireWorkspaceMember, requireRole } from '../../middleware/authorize'
import { prisma } from '../../lib/prisma'
import { auditLogOp, AuditAction } from '../../lib/audit'
import { paginationSchema } from '../../lib/pagination'
import { memberFilterSchema } from '../../lib/filters'
import { ForbiddenError, NotFoundError } from '../../lib/errors'
import { StatusCodes } from 'http-status-codes'

const ROLE_HIERARCHY: Role[] = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER']

const router = Router({ mergeParams: true })

router.use(authenticate)
router.use(requireWorkspaceMember)

const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
})

/**
 * GET /workspaces/:slug/members — cursor-paginated + role filter.
 * ?role=OWNER|ADMIN|MEMBER|VIEWER
 */
router.get('/', async (req: Request, res: Response) => {
  const { limit, cursor } = paginationSchema.parse(req.query)
  const { role } = memberFilterSchema.parse(req.query)
  const workspace = await prisma.workspace.findUnique({
    where: { slug: req.params.slug },
  })
  if (!workspace) throw new NotFoundError('Workspace')

  const members = await prisma.membership.findMany({
    where: {
      workspaceId: workspace.id,
      ...(role ? { role } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { joinedAt: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasNext = members.length > limit
  const page = hasNext ? members.slice(0, limit) : members
  const nextCursor = hasNext ? page[page.length - 1]?.id : null

  res.json({ members: page, nextCursor })
})

/**
 * PATCH /workspaces/:slug/members/:userId — update role.
 * Audit: MEMBER_ROLE_CHANGED
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

    const callerRoleIndex = ROLE_HIERARCHY.indexOf(req.currentMembership!.role)
    const newRoleIndex = ROLE_HIERARCHY.indexOf(role)
    if (newRoleIndex > callerRoleIndex) {
      throw new ForbiddenError('You cannot assign a role higher than your own')
    }

    const [updated] = await prisma.$transaction([
      prisma.membership.update({
        where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
        data: { role },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      auditLogOp({
        workspaceId: workspace.id,
        actorId: req.currentUser!.id,
        action: AuditAction.MEMBER_ROLE_CHANGED,
        targetId: userId,
        metadata: { before: targetMembership.role, after: role },
      }),
    ])

    res.json({ membership: updated })
  }
)

/**
 * DELETE /workspaces/:slug/members/:userId — remove member.
 * Audit: MEMBER_LEFT (self) or MEMBER_LEFT (removed by admin)
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

    if (targetMembership.role === 'OWNER') {
      throw new ForbiddenError('Cannot remove the workspace owner')
    }

    const isSelf = userId === currentUser.id
    const isAdminOrAbove = ['ADMIN', 'OWNER'].includes(currentMembership.role)

    if (!isSelf && !isAdminOrAbove) {
      throw new ForbiddenError('Insufficient permissions to remove this member')
    }

    await prisma.$transaction([
      prisma.membership.delete({
        where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
      }),
      auditLogOp({
        workspaceId: workspace.id,
        actorId: currentUser.id,
        action: AuditAction.MEMBER_LEFT,
        targetId: userId,
      }),
    ])

    res.status(StatusCodes.NO_CONTENT).send()
  }
)

export default router
