import { Router, Request, Response } from 'express'
import { z } from 'zod'
import slugify from 'slugify'
import { authenticate } from '../../middleware/authenticate'
import { requireWorkspaceMember, requireRole } from '../../middleware/authorize'
import { requireVerifiedEmail } from '../../middleware/verifyEmail'
import { requireActiveWorkspace } from '../../middleware/requireActiveWorkspace'
import { prisma } from '../../lib/prisma'
import { auditLogOp, AuditAction } from '../../lib/audit'
import { paginationSchema } from '../../lib/pagination'
import { workspaceFilterSchema, auditLogFilterSchema } from '../../lib/filters'
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
 * Create a new workspace. Requires a verified email. Creator becomes OWNER.
 */
router.post('/', requireVerifiedEmail, async (req: Request, res: Response) => {
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
 * List workspaces the user belongs to (cursor-paginated + filtered).
 * ?q=search             — case-insensitive match on name or slug
 * ?includeArchived=true — include archived workspaces (default: excluded)
 */
router.get('/', async (req: Request, res: Response) => {
  const { limit, cursor } = paginationSchema.parse(req.query)
  const { q, includeArchived } = workspaceFilterSchema.parse(req.query)
  const user = req.currentUser!

  const memberships = await prisma.membership.findMany({
    where: {
      userId: user.id,
      workspace: {
        ...(!includeArchived ? { archivedAt: null } : {}),
        ...(q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ]
        } : {}),
      },
    },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasNext = memberships.length > limit
  const page = hasNext ? memberships.slice(0, limit) : memberships
  const nextCursor = hasNext ? page[page.length - 1]?.id : null

  const workspaces = page.map((m: typeof page[number]) => ({
    ...m.workspace,
    role: m.role,
    joinedAt: m.joinedAt,
  }))

  res.json({ workspaces, nextCursor })
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
 * Cursor-paginated audit log with optional action and actor filters. ADMIN+ only.
 * ?action=INVITE_SENT|MEMBER_ROLE_CHANGED|...  — filter by event type
 * ?actorId=uuid   — filter by the user who triggered the event
 */
router.get(
  '/:slug/audit-logs',
  requireWorkspaceMember,
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const { limit, cursor } = paginationSchema.parse(req.query)
    const { action, actorId } = auditLogFilterSchema.parse(req.query)
    const workspace = await prisma.workspace.findUnique({
      where: { slug: req.params.slug },
    })
    if (!workspace) throw new NotFoundError('Workspace')

    const logs = await prisma.auditLog.findMany({
      where: {
        workspaceId: workspace.id,
        ...(action ? { action } : {}),
        ...(actorId ? { actorId } : {}),
      },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasNext = logs.length > limit
    const page = hasNext ? logs.slice(0, limit) : logs
    const nextCursor = hasNext ? page[page.length - 1]?.id : null

    res.json({ logs: page, nextCursor })
  }
)

/**
 * PATCH /workspaces/:slug/archive — OWNER only.
 * Marks workspace as archived. All member write operations will return 403 after this.
 * The workspace remains visible (read-only) to existing members.
 */
router.patch(
  '/:slug/archive',
  requireWorkspaceMember,
  requireRole('OWNER'),
  async (req: Request, res: Response) => {
    const workspace = await prisma.workspace.findFirst({
      where: { slug: req.params.slug },
    })
    if (!workspace) throw new NotFoundError('Workspace')
    if (workspace.archivedAt) {
      throw new ConflictError('Workspace is already archived')
    }

    const updated = await prisma.workspace.update({
      where: { id: workspace.id },
      data: { archivedAt: new Date() },
    })

    res.json({ workspace: updated, message: 'Workspace archived successfully' })
  }
)

/**
 * PATCH /workspaces/:slug/unarchive — OWNER only.
 * Restores an archived workspace to active status.
 */
router.patch(
  '/:slug/unarchive',
  requireWorkspaceMember,
  requireRole('OWNER'),
  async (req: Request, res: Response) => {
    const workspace = await prisma.workspace.findFirst({
      where: { slug: req.params.slug },
    })
    if (!workspace) throw new NotFoundError('Workspace')
    if (!workspace.archivedAt) {
      throw new ConflictError('Workspace is not archived')
    }

    const updated = await prisma.workspace.update({
      where: { id: workspace.id },
      data: { archivedAt: null },
    })

    res.json({ workspace: updated, message: 'Workspace unarchived successfully' })
  }
)

export default router
