import { prisma } from './prisma'
import { Prisma } from '@prisma/client'
import { AuditAction } from '@prisma/client'

export { AuditAction }

interface AuditLogInput {
    workspaceId: string
    actorId: string
    action: AuditAction
    targetId?: string
    metadata?: Prisma.InputJsonObject
}

/**
 * Returns a Prisma create operation suitable for inclusion in $transaction([...]),
 * so an audit entry is written atomically with the action it records.
 */
export function auditLogOp(input: AuditLogInput) {
    return prisma.auditLog.create({ data: input })
}
