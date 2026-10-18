import { Db, transaction } from './database'

type Migration = { version: number; name: string; sql: string }

/** Append-only. Never edit a migration that has shipped; add a new version instead. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
        start_date TEXT NOT NULL CHECK (date(start_date) IS start_date),
        deadline TEXT NOT NULL CHECK (date(deadline) IS deadline),
        priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')),
        reminder TEXT NOT NULL CHECK (reminder IN ('Minimal', 'Smart', 'Frequent', 'Evening', 'Weekend')),
        source TEXT CHECK (source IS NULL OR length(source) BETWEEN 1 AND 40),
        source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 200),
        count_done INTEGER,
        count_total INTEGER,
        count_unit TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (deadline >= start_date),
        CHECK (source_ref IS NULL OR source IS NOT NULL),
        CHECK (
          (count_total IS NULL AND count_done IS NULL AND count_unit IS NULL) OR
          (count_total BETWEEN 1 AND 100000 AND count_done BETWEEN 0 AND count_total AND length(count_unit) BETWEEN 1 AND 40)
        )
      );
      CREATE UNIQUE INDEX tasks_source_ref_unique ON tasks (source, source_ref) WHERE source_ref IS NOT NULL;
      CREATE INDEX tasks_deadline_idx ON tasks (deadline);
      CREATE INDEX tasks_completed_idx ON tasks (completed_at);

      CREATE TABLE subtasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
        position INTEGER NOT NULL CHECK (position >= 0),
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (done = 1 OR completed_at IS NULL)
      );
      CREATE INDEX subtasks_task_idx ON subtasks (task_id, position);

      CREATE TABLE preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
        greeting TEXT NOT NULL CHECK (greeting IN ('Welcome', 'Welcome back', 'Good evening')),
        default_duration INTEGER NOT NULL CHECK (default_duration BETWEEN 1 AND 60),
        working_hours TEXT NOT NULL CHECK (working_hours IN ('9 AM – 5 PM', '2 PM – 8 PM', '6 PM – 11 PM')),
        reminder TEXT NOT NULL CHECK (reminder IN ('Minimal', 'Smart', 'Frequent')),
        insights_since TEXT,
        updated_at TEXT NOT NULL
      );

      -- Connection state only. OAuth tokens will get their own table (encrypted at rest) with the real integrations.
      CREATE TABLE integrations (
        provider TEXT PRIMARY KEY CHECK (provider IN ('gcal', 'gmail', 'notion', 'slack', 'github', 'drive', 'outlook')),
        mode TEXT NOT NULL CHECK (mode IN ('disconnected', 'demo', 'connected')),
        account TEXT,
        settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
        last_synced_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE reminder_deliveries (
        key TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        delivered_at TEXT NOT NULL
      );
      CREATE INDEX reminder_deliveries_task_idx ON reminder_deliveries (task_id);

      CREATE TABLE idempotency_keys (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      );
    `,
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version))
  const newest = Math.max(0, ...applied)
  if (newest > LATEST_VERSION) {
    throw new Error(`The database schema (v${newest}) is newer than this version of MIRA supports (v${LATEST_VERSION}). Refusing to start so no data is lost.`)
  }
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    transaction(db, () => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString())
    })
  }
}
