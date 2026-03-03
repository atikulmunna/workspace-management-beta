import { Router, Request, Response } from 'express'
import { z } from 'zod'
import slugify from 'slugify'
import { authenticate } from '../../middleware/authenticate'
import { requireWorkspaceMember, requireRole } from '../../middleware/authorize'
import { prisma } from '../../lib/prisma'
import { auditLogOp, AuditAction } from '../../lib/audit'
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors'
import { StatusCodes } from 'http-status-codes'

const router = Router()

// All workspace routes require authentication
router.use(authenticate)

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().max(256).optional(),
  slug: z.string().min(2).max(64).optional(), // auto-generated if not provided
})

const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(64).optional(),
  description: z.string().max(256).optional(),
})

/**
 * POST /workspaces
 * Create a new workspace. Creator becomes OWNER.
 */
router.post('/', async (req: Request, res: Response) => {
  const body = createWorkspaceSchema.parse(req.body)
  const user = req.currentUser!

  const slug =
    body.slug ??
    slugify(body.name, { lower: true, strict: true, trim: true })

  const existing = await prisma.workspace.findUnique({ where: { slug } })
  if (existing) throw new ConflictError(`Slug "${slug}" is already taken`)

  const workspace = await prisma.workspace.create({
    data: {
      name: body.name,
      slug,
      description: body.description,
      memberships: {
        create: {
          userId: user.id,
          role: 'OWNER',
        },
      },
    },
  })

  res.status(StatusCodes.CREATED).json({ workspace })
})

/**
 * GET /workspaces
 * List all workspaces the current user belongs to.
 */
router.get('/', async (req: Request, res: Response) => {
  const user = req.currentUser!

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  })

  const workspaces = memberships.map((m: typeof memberships[number]) => ({
    ...m.workspace,
    role: m.role,
    joinedAt: m.joinedAt,
  }))

  res.json({ workspaces })
})

/**
 * GET /workspaces/:slug
 * Get a single workspace (must be a member).
 */
router.get('/:slug', requireWorkspaceMember, async (req: Request, res: Response) => {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: req.params.slug },
    include: { _count: { select: { memberships: true } } },
  })

  if (!workspace) throw new NotFoundError('Workspace')

  res.json({ workspace, role: req.currentMembership!.role })
})

/**
 * PATCH /workspaces/:slug
 * Update workspace details. Requires ADMIN or above.
 */
router.patch(
  '/:slug',
  requireWorkspaceMember,
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const body = updateWorkspaceSchema.parse(req.body)

    const workspace = await prisma.workspace.update({
      where: { slug: req.params.slug },
      data: body,
    })

    res.json({ workspace })
  }
)

/**
 * DELETE /workspaces/:slug
 * Delete a workspace. OWNER only.
 */
router.delete(
  '/:slug',
  requireWorkspaceMember,
  requireRole('OWNER'),
  async (req: Request, res: Response) => {
    await prisma.workspace.delete({ where: { slug: req.params.slug } })
    res.status(StatusCodes.NO_CONTENT).send()
  }
)

/**
 * PATCH /workspaces/:slug/transfer-owner
 * Transfer OWNER role to another workspace member. OWNER only.
 * Atomically downgrades caller to ADMIN and upgrades target to OWNER.
 */
const transferOwnerSchema = z.object({
  userId: z.string().uuid(),
})

router.patch(
  '/:slug/transfer-owner',
  requireWorkspaceMember,
  requireRole('OWNER'),
  async (req: Request, res: Response) => {
    const { userId: targetUserId } = transferOwnerSchema.parse(req.body)
    const caller = req.currentUser!
    const callerMem = req.currentMembership!

    if (targetUserId === caller.id) {
      throw new ForbiddenError('You cannot transfer ownership to yourself')
    }

    const workspace = await prisma.workspace.findUnique({
      where: { slug: req.params.slug },
    })
    if (!workspace) throw new NotFoundError('Workspace')

    const targetMem = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId: workspace.id } },
    })
    if (!targetMem) throw new NotFoundError('Member')
    if (targetMem.role === 'OWNER') {
      throw new ForbiddenError('Target user is already the owner')
    }

    // Atomic swap: demote caller → ADMIN, promote target → OWNER, log
    const [, updatedTarget] = await prisma.$transaction([
      prisma.membership.update({
        where: { id: callerMem.id },
        data: { role: 'ADMIN' },
      }),
      prisma.membership.update({
        where: { id: targetMem.id },
        data: { role: 'OWNER' },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      auditLogOp({
        workspaceId: workspace.id,
        actorId: caller.id,
        action: AuditAction.OWNERSHIP_TRANSFERRED,
        targetId: targetUserId,
        metadata: { from: caller.id, to: targetUserId },
      }),
    ])

    res.json({
      message: 'Ownership transferred successfully',
      newOwner: updatedTarget,
      prevOwner: { ...callerMem, role: 'ADMIN' },
    })
  }
)

/**
 * GET /workspaces/:slug/audit-logs
 * Returns the audit log for a workspace. ADMIN+ only.
 * Newest first, max 100 entries (pagination coming later).
 */
router.get(
  '/:slug/audit-logs',
  requireWorkspaceMember,
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const workspace = await prisma.workspace.findUnique({
      where: { slug: req.params.slug },
    })
    if (!workspace) throw new NotFoundError('Workspace')

    const logs = await prisma.auditLog.findMany({
      where: { workspaceId: workspace.id },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    res.json({ logs })
  }
)

export default router
