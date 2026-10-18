import type { Db } from '../db/database'

/** Delivery log: a reminder key is recorded once, which is what prevents duplicate notifications. */
export class ReminderRepository {
  constructor(private readonly db: Db) {}

  deliveredKeys(): Set<string> {
    return new Set((this.db.prepare('SELECT key FROM reminder_deliveries').all() as { key: string }[]).map((r) => r.key))
  }

  /** Returns how many keys were newly recorded (already-delivered keys are ignored). */
  record(entries: { key: string; taskId: string }[], at: string) {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO reminder_deliveries (key, task_id, delivered_at) SELECT ?, id, ? FROM tasks WHERE id = ?')
    return entries.reduce((n, e) => n + Number(stmt.run(e.key, at, e.taskId).changes), 0)
  }
}

export type StoredResponse = { requestHash: string; status: number; body: string }

/** Remembers responses to POST requests sent with an Idempotency-Key so a retried request is not applied twice. */
export class IdempotencyRepository {
  static readonly TTL_MS = 24 * 3600 * 1000
  constructor(private readonly db: Db) {}

  find(scope: string, key: string): StoredResponse | null {
    const r = this.db.prepare('SELECT request_hash, status, body FROM idempotency_keys WHERE scope = ? AND key = ?').get(scope, key) as
      | { request_hash: string; status: number; body: string } | undefined
    return r ? { requestHash: r.request_hash, status: r.status, body: r.body } : null
  }

  save(scope: string, key: string, value: StoredResponse, now: Date) {
    this.db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(new Date(now.getTime() - IdempotencyRepository.TTL_MS).toISOString())
    this.db.prepare('INSERT OR REPLACE INTO idempotency_keys (scope, key, request_hash, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(scope, key, value.requestHash, value.status, value.body, now.toISOString())
  }
}
