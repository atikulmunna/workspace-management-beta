import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
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

  // Known Prisma errors — map to sensible HTTP codes instead of a generic 500.
  // Guards against races that slip past application-level checks
  // (e.g. a duplicate slug created between our findUnique and create).
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(StatusCodes.CONFLICT).json({
        error: { code: 'CONFLICT', message: 'A record with these details already exists' },
      })
    }
    if (err.code === 'P2025') {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: { code: 'NOT_FOUND', message: 'The requested record was not found' },
      })
    }
    // Any other known Prisma error falls through to the generic 500 below.
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
