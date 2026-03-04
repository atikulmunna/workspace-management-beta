import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../lib/errors'

/**
 * Hard gate: requires the authenticated user to have verified their email.
 * Must be placed AFTER the `authenticate` middleware array.
 *
 * Returns 403 with code EMAIL_NOT_VERIFIED if emailVerifiedAt is null.
 */
export const requireVerifiedEmail = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    if (!req.currentUser?.emailVerifiedAt) {
        return next(
            new ForbiddenError(
                'Email not verified. Please sign in via a magic link to verify your email address.'
            )
        )
    }
    next()
}
