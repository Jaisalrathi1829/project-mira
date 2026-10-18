import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createApp, type AppOptions } from '../../server/app'
import { openDatabase, type Db } from '../../server/db/database'
import { initializeDatabase } from '../../server/db/initialize'

export const TEST_NOW = new Date('2026-10-08T09:00:00Z') // Thursday 8 October 2026, UTC

export type TestServer = Awaited<ReturnType<typeof startServer>>
export type Res = { status: number; body: any; headers: Headers }

export async function startServer(opts: { dbPath?: string; db?: Db; seed?: boolean; now?: () => Date; timeZone?: string | null; config?: Partial<AppOptions['config']> } = {}) {
  const db = opts.db ?? openDatabase(opts.dbPath ?? ':memory:')
  const now = opts.now ?? (() => TEST_NOW)
  // null = the machine's zone (what the browser-side code under test uses)
  const timeZone = opts.timeZone === null ? undefined : opts.timeZone ?? 'UTC'
  if (!opts.db) initializeDatabase(db, { seed: opts.seed ?? false, now: now(), timeZone })
  const app = createApp({
    db, now, log: () => undefined,
    config: {
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'], allowedOrigins: ['http://localhost:8443'], staticDir: null,
      timeZone, googleCredentialsConfigured: false, logRequests: false, ...opts.config,
    },
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
  }

  return {
    base, db, call,
    close: (closeDb = true) => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => { if (closeDb) db.close(); resolve() })
    }),
  }
}
