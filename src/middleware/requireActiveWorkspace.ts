import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { ForbiddenError, NotFoundError } from '../lib/errors'

/**
 * requireActiveWorkspace — blocks any write operations on archived workspaces.
 *
 * Must be mounted AFTER `requireWorkspaceMember` so `req.params.slug` is available.
 * Returns 403 WORKSPACE_ARCHIVED when the workspace has an `archivedAt` timestamp.
 */
export async function requireActiveWorkspace(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {
    const workspace = await prisma.workspace.findFirst({
        where: { slug: req.params.slug },
        select: { id: true, archivedAt: true },
    })

    if (!workspace) throw new NotFoundError('Workspace')

    if (workspace.archivedAt) {
        throw new ForbiddenError(
            'This workspace is archived and does not accept write operations. ' +
            'Unarchive it first via PATCH /workspaces/:slug/unarchive.'
        )
    }

    next()
}
