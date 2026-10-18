import { createHash } from 'node:crypto'
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'
import type { ApiErrorBody } from '../../shared/types'
import type { Config } from '../config'
import { AppError } from '../errors'
import type { IdempotencyRepository } from '../repositories/miscRepositories'

/* ---------- Local-only access ---------- */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const hostname = (host: string) => (host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]).toLowerCase()

/**
 * MIRA's API is for the single local user. Requests must come from this machine (directly, or through the Vite
 * dev proxy, whose X-Forwarded-For hop is checked), carry a loopback Host header (blocks DNS rebinding) and, when
 * a browser sends an Origin, come from a trusted origin. CORS headers are only returned to trusted origins.
 */
export function localOnly(config: Pick<Config, 'allowedHosts' | 'allowedOrigins'>): RequestHandler {
  const hosts = new Set(config.allowedHosts.map((h) => h.toLowerCase()))
  const origins = new Set(config.allowedOrigins)
  return (req, res, next) => {
    const peer = req.socket.remoteAddress ?? ''
    const forwarded = req.headers['x-forwarded-for']
    const lastHop = typeof forwarded === 'string' ? forwarded.split(',').pop()!.trim() : null
    if (!LOOPBACK.has(peer) || (lastHop !== null && !LOOPBACK.has(lastHop))) return deny(res, 'MIRA only accepts requests from this computer.')
    if (!hosts.has(hostname(req.headers.host ?? ''))) return deny(res, 'Unrecognised host.')
    const origin = req.headers.origin
    if (origin) {
      if (!origins.has(origin)) return deny(res, 'Origin not allowed.')
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key')
      res.setHeader('Access-Control-Max-Age', '600')
    }
    if (req.method === 'OPTIONS') return void res.status(204).end()
    next()
  }
}

function deny(res: Response, message: string) {
  res.status(403).json({ error: { code: 'FORBIDDEN', message } } satisfies ApiErrorBody)
}

export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  next()
}

/* ---------- Idempotency ---------- */

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/

/**
 * POST handlers wrapped with this honour an `Idempotency-Key` header: a retried request with the same key and body
 * receives the original response instead of creating a second record. The same key with a different body is rejected.
 * Handlers are synchronous against SQLite, so check-and-store cannot interleave between requests.
 */
export function idempotent(repo: IdempotencyRepository, now: () => Date, handler: (req: Request, res: Response) => void): RequestHandler {
  return (req, res, next: NextFunction) => {
    const key = req.get('Idempotency-Key')
    if (key === undefined) return handler(req, res)
    if (!KEY_RE.test(key)) throw new AppError(400, 'BAD_REQUEST', 'Idempotency-Key must be 8–100 letters, digits, "-" or "_".')
    const scope = `${req.method} ${req.baseUrl}${req.path}`
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex')
    const stored = repo.find(scope, key)
    if (stored) {
      if (stored.requestHash !== requestHash) throw new AppError(422, 'VALIDATION_ERROR', 'This Idempotency-Key was already used for a different request.')
      res.setHeader('Idempotent-Replayed', 'true')
      return void res.status(stored.status).type('application/json').send(stored.body)
    }
    const json = res.json.bind(res)
    res.json = (body: unknown) => {
      if (res.statusCode < 300) repo.save(scope, key, { requestHash, status: res.statusCode, body: JSON.stringify(body) }, now())
      return json(body)
    }
    try {
      handler(req, res)
    } catch (err) {
      next(err)
    }
  }
}

/* ---------- Errors ---------- */

export const notFoundRoute: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}.` } } satisfies ApiErrorBody)
}

type SqliteError = Error & { code?: string; errcode?: number }

/** Maps every failure to the documented error shape without leaking stack traces or SQL. */
export function errorHandler(log: (msg: string, err?: unknown) => void): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const send = (status: number, body: ApiErrorBody) => void res.status(status).json(body)
    if (err instanceof AppError) return send(err.status, { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } })
    if (err instanceof ZodError) {
      return send(422, { error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid request.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } })
    }
    const type = (err as { type?: string }).type
    if (type === 'entity.parse.failed') return send(400, { error: { code: 'BAD_REQUEST', message: 'The request body is not valid JSON.' } })
    if (type === 'entity.too.large') return send(413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' } })
    const sqlite = err as SqliteError
    if (sqlite.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint/.test(sqlite.message)) return send(409, { error: { code: 'CONFLICT', message: 'This record already exists.' } })
    if (sqlite.code === 'ERR_SQLITE_ERROR' && /(CHECK|NOT NULL|FOREIGN KEY) constraint/.test(sqlite.message)) return send(422, { error: { code: 'VALIDATION_ERROR', message: 'The data was rejected by the database rules.' } })
    log('Unhandled error', err)
    send(500, { error: { code: 'INTERNAL', message: 'Something went wrong in the MIRA server.' } })
  }
}
