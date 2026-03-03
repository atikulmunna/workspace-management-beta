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
 * Create an audit log entry (fire-and-forget outside of transactions).
 */
export function auditLog(input: AuditLogInput) {
    return prisma.auditLog.create({ data: input })
}

/**
 * Returns a Prisma create operation suitable for inclusion in $transaction([...]).
 */
export function auditLogOp(input: AuditLogInput) {
    return prisma.auditLog.create({ data: input })
}
