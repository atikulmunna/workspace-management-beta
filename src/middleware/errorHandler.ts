import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors'
import { config } from '../config'
import { StatusCodes } from 'http-status-codes'

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues: err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    })
  }

  // JWT errors from express-jwt
  if (err.name === 'UnauthorizedError') {
    return res.status(StatusCodes.UNAUTHORIZED).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' },
    })
  }

  // Our custom app errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    })
  }

  // Unknown errors
  console.error('[Unhandled Error]', err)
  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isDev ? err.message : 'Something went wrong',
    },
  })
}
