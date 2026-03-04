import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { requireWorkspaceMember, requireRole } from '../../middleware/authorize'
import { requireVerifiedEmail } from '../../middleware/verifyEmail'
import { prisma } from '../../lib/prisma'
import { auditLogOp, AuditAction } from '../../lib/audit'
import { paginationSchema } from '../../lib/pagination'
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors'
import { sendInvitationEmail } from '../../lib/email'
import { StatusCodes } from 'http-status-codes'

export const workspaceInvitationRouter = Router({ mergeParams: true })
export const invitationRouter = Router()

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
})

// ── Workspace-scoped routes ───────────────────────────────────────────────────

workspaceInvitationRouter.use(authenticate)
workspaceInvitationRouter.use(requireWorkspaceMember)

/**
 * GET /workspaces/:slug/invitations — paginated list of pending invitations. ADMIN+.
 */
workspaceInvitationRouter.get(
  '/',
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const { limit, cursor } = paginationSchema.parse(req.query)
    const workspace = await prisma.workspace.findUnique({ where: { slug: req.params.slug } })
    if (!workspace) throw new NotFoundError('Workspace')

    const invitations = await prisma.invitation.findMany({
      where: { workspaceId: workspace.id, status: 'PENDING' },
      include: { invitedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasNext = invitations.length > limit
    const page = hasNext ? invitations.slice(0, limit) : invitations
    const nextCursor = hasNext ? page[page.length - 1]?.id : null

    res.json({ invitations: page, nextCursor })
  }
)

/**
 * POST /workspaces/:slug/invitations — invite by email. ADMIN+. Requires verified email.
 * Audit: INVITE_SENT
 */
workspaceInvitationRouter.post(
  '/',
  requireRole('ADMIN'),
  requireVerifiedEmail,
  async (req: Request, res: Response) => {
    const { email, role } = inviteSchema.parse(req.body)
    const user = req.currentUser!

    const workspace = await prisma.workspace.findUnique({ where: { slug: req.params.slug } })
    if (!workspace) throw new NotFoundError('Workspace')

    const existingMember = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { workspaceId: workspace.id } } },
    })
    if (existingMember?.memberships.length) {
      throw new ConflictError('This user is already a member of this workspace')
    }

    const existingInvitation = await prisma.invitation.findFirst({
      where: { email, workspaceId: workspace.id, status: 'PENDING' },
    })
    if (existingInvitation) {
      throw new ConflictError('A pending invitation already exists for this email')
    }

    const [invitation] = await prisma.$transaction([
      prisma.invitation.create({
        data: {
          email,
          role,
          workspaceId: workspace.id,
          invitedById: user.id,
          expiresAt: new Date(Date.now() + SEVEN_DAYS),
        },
      }),
      auditLogOp({
        workspaceId: workspace.id,
        actorId: user.id,
        action: AuditAction.INVITE_SENT,
        metadata: { email, role },
      }),
    ])

    sendInvitationEmail({
      to: email,
      workspaceName: workspace.name,
      inviterName: user.name ?? user.email,
      invitationId: invitation.id,
    }).catch(console.error)

    res.status(StatusCodes.CREATED).json({ invitation })
  }
)

/**
 * DELETE /workspaces/:slug/invitations/:invitationId — revoke. ADMIN+.
 * Audit: INVITE_REVOKED
 */
workspaceInvitationRouter.delete(
  '/:invitationId',
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const { invitationId } = req.params

    const workspace = await prisma.workspace.findUnique({ where: { slug: req.params.slug } })
    if (!workspace) throw new NotFoundError('Workspace')

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, workspaceId: workspace.id },
    })
    if (!invitation) throw new NotFoundError('Invitation')
    if (invitation.status !== 'PENDING') {
      throw new ConflictError('Only pending invitations can be revoked')
    }

    await prisma.$transaction([
      prisma.invitation.update({
        where: { id: invitationId },
        data: { status: 'REVOKED' },
      }),
      auditLogOp({
        workspaceId: workspace.id,
        actorId: req.currentUser!.id,
        action: AuditAction.INVITE_REVOKED,
        targetId: invitationId,
      }),
    ])

    res.status(StatusCodes.NO_CONTENT).send()
  }
)

// ── Top-level invitation routes ───────────────────────────────────────────────

/**
 * POST /invitations/:id/accept — accept an invitation.
 * Audit: INVITE_ACCEPTED + MEMBER_JOINED (same txn)
 */
invitationRouter.post('/:id/accept', authenticate, async (req: Request, res: Response) => {
  const user = req.currentUser!
  const invitation = await prisma.invitation.findUnique({
    where: { id: req.params.id },
    include: { workspace: true },
  })

  if (!invitation) throw new NotFoundError('Invitation')
  if (invitation.status !== 'PENDING') throw new ForbiddenError('This invitation is no longer valid')
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } })
    throw new ForbiddenError('This invitation has expired')
  }
  if (invitation.email !== user.email) {
    throw new ForbiddenError('This invitation was not sent to your email address')
  }

  const [membership] = await prisma.$transaction([
    prisma.membership.create({
      data: { userId: user.id, workspaceId: invitation.workspaceId, role: invitation.role },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED' },
    }),
    auditLogOp({
      workspaceId: invitation.workspaceId,
      actorId: user.id,
      action: AuditAction.INVITE_ACCEPTED,
      targetId: invitation.id,
    }),
  ])

  res.status(StatusCodes.CREATED).json({ membership, workspace: invitation.workspace })
})
