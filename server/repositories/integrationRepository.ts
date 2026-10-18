import type { ConnectionMode, ProviderId } from '../../shared/types'
import type { Db } from '../db/database'

export type IntegrationRow = { provider: ProviderId; mode: ConnectionMode; account: string | null; settings: Record<string, boolean>; lastSyncedAt: string | null }
type Row = { provider: ProviderId; mode: ConnectionMode; account: string | null; settings: string; last_synced_at: string | null }

export class IntegrationRepository {
  constructor(private readonly db: Db) {}

  all(): Map<ProviderId, IntegrationRow> {
    const rows = this.db.prepare('SELECT * FROM integrations').all() as Row[]
    return new Map(rows.map((r) => [r.provider, { provider: r.provider, mode: r.mode, account: r.account, settings: JSON.parse(r.settings), lastSyncedAt: r.last_synced_at }]))
  }

  get(provider: ProviderId): IntegrationRow | null {
    return this.all().get(provider) ?? null
  }

  upsert(provider: ProviderId, fields: { mode?: ConnectionMode; account?: string | null; settings?: Record<string, boolean>; lastSyncedAt?: string | null }, at: string) {
    const current = this.get(provider)
    const next = {
      mode: fields.mode ?? current?.mode ?? 'disconnected',
      account: fields.account !== undefined ? fields.account : current?.account ?? null,
      settings: fields.settings ?? current?.settings ?? {},
      lastSyncedAt: fields.lastSyncedAt !== undefined ? fields.lastSyncedAt : current?.lastSyncedAt ?? null,
    }
    this.db.prepare(`INSERT INTO integrations (provider, mode, account, settings, last_synced_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider) DO UPDATE SET mode = excluded.mode, account = excluded.account, settings = excluded.settings, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`)
      .run(provider, next.mode, next.account, JSON.stringify(next.settings), next.lastSyncedAt, at)
  }
}
