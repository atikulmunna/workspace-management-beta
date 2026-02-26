import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { requireWorkspaceMember, requireRole } from '../../middleware/authorize'
import { prisma } from '../../lib/prisma'
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors'
import { sendInvitationEmail } from '../../lib/email'
import { StatusCodes } from 'http-status-codes'

// Two routers:
// 1. Workspace-scoped: /workspaces/:slug/invitations
// 2. Top-level: /invitations/:id (for accepting)

export const workspaceInvitationRouter = Router({ mergeParams: true })
export const invitationRouter = Router()

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
})

// ── Workspace-scoped routes ──────────────────────────────────────────────────

workspaceInvitationRouter.use(authenticate)
workspaceInvitationRouter.use(requireWorkspaceMember)

/**
 * GET /workspaces/:slug/invitations
 * List pending invitations for a workspace. ADMIN+.
 */
workspaceInvitationRouter.get(
  '/',
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const workspace = await prisma.workspace.findUnique({ where: { slug: req.params.slug } })
    if (!workspace) throw new NotFoundError('Workspace')

    const invitations = await prisma.invitation.findMany({
      where: { workspaceId: workspace.id, status: 'PENDING' },
      include: { invitedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })

    res.json({ invitations })
  }
)

/**
 * POST /workspaces/:slug/invitations
 * Invite a user by email. ADMIN+.
 */
workspaceInvitationRouter.post(
  '/',
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    const { email, role } = inviteSchema.parse(req.body)
    const user = req.currentUser!

    const workspace = await prisma.workspace.findUnique({ where: { slug: req.params.slug } })
    if (!workspace) throw new NotFoundError('Workspace')

    // Check if user is already a member
    const existingMember = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: { where: { workspaceId: workspace.id } },
      },
    })
    if (existingMember?.memberships.length) {
      throw new ConflictError('This user is already a member of this workspace')
    }

    // Check for existing pending invitation
    const existingInvitation = await prisma.invitation.findFirst({
      where: { email, workspaceId: workspace.id, status: 'PENDING' },
    })
    if (existingInvitation) {
      throw new ConflictError('A pending invitation already exists for this email')
    }

    const invitation = await prisma.invitation.create({
      data: {
        email,
        role,
        workspaceId: workspace.id,
        invitedById: user.id,
        expiresAt: new Date(Date.now() + SEVEN_DAYS),
      },
    })

    // Send invitation email (non-blocking)
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
 * DELETE /workspaces/:slug/invitations/:invitationId
 * Revoke a pending invitation. ADMIN+.
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

    await prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED' },
    })

    res.status(StatusCodes.NO_CONTENT).send()
  }
)

// ── Top-level invitation routes ──────────────────────────────────────────────

/**
 * POST /invitations/:id/accept
 * Accept an invitation. User must be authenticated.
 * Their email must match the invitation email.
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

  // Create membership + mark invitation accepted (in a transaction)
  const [membership] = await prisma.$transaction([
    prisma.membership.create({
      data: {
        userId: user.id,
        workspaceId: invitation.workspaceId,
        role: invitation.role,
      },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED' },
    }),
  ])

  res.status(StatusCodes.CREATED).json({
    membership,
    workspace: invitation.workspace,
  })
})
