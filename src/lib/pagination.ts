import { z } from 'zod'

/**
 * Reusable Zod schema for cursor-based pagination query params.
 * Usage: const { limit, cursor } = paginationSchema.parse(req.query)
 */
export const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),   // the `id` of the last item from the previous page
})

export type PaginationParams = z.infer<typeof paginationSchema>
