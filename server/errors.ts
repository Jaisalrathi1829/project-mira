import type { ApiErrorCode } from '../shared/types'

export type ErrorDetail = { path: string; message: string }

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string, readonly details?: ErrorDetail[]) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`)
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message)
export const invalid = (message: string, details?: ErrorDetail[]) => new AppError(422, 'VALIDATION_ERROR', message, details)
export const notImplemented = (message: string) => new AppError(501, 'NOT_IMPLEMENTED', message)
