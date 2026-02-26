import { StatusCodes } from 'http-status-codes'

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = StatusCodes.INTERNAL_SERVER_ERROR,
    public code?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, StatusCodes.NOT_FOUND, 'NOT_FOUND')
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, StatusCodes.UNAUTHORIZED, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, StatusCodes.FORBIDDEN, 'FORBIDDEN')
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, StatusCodes.CONFLICT, 'CONFLICT')
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, StatusCodes.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR')
  }
}
