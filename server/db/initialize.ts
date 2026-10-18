import { randomUUID } from 'node:crypto'
import { ISODate, addDays, localDateOf } from '../../shared/dates'
import type { Priority, TaskReminder } from '../../shared/types'
import { Db, transaction } from './database'
import { migrate } from './migrations'

type SeedTask = {
  title: string; description: string; start: number; end: number; priority: Priority; reminder: TaskReminder
  subtasks: [string, boolean][]; count?: { done: number; total: number; unit: string }; completed?: boolean; source?: [string, string]
}

/**
 * The prototype's example tasks. Offsets are days relative to the first run (the prototype's "8 October"
 * is day 0), so a fresh database shows the same picture the design was made with.
 */
const DEMO_TASKS: SeedTask[] = [
  { title: 'Computer Networks Assignment', description: 'Report on congestion control in TCP — compare Reno, CUBIC and BBR with references.', start: -1, end: 2, priority: 'High', reminder: 'Smart', source: ['Gmail', 'demo:m1'],
    subtasks: [['Research topic', true], ['Collect references', true], ['Write report', false], ['Review', false], ['Submit', false]] },
  { title: 'DSA Practice', description: 'Graph problems — BFS, DFS, shortest paths.', start: -1, end: 0, priority: 'Medium', reminder: 'Evening', subtasks: [], count: { done: 8, total: 12, unit: 'problems' } },
  { title: 'DBMS Mini Project', description: 'Library management schema, normalised to 3NF, with a small query interface.', start: -3, end: 5, priority: 'High', reminder: 'Smart',
    subtasks: [['ER diagram', true], ['Schema & normalisation', false], ['Seed data', false], ['Query interface', false], ['Write-up', false]] },
  { title: 'Operating Systems Lab Report', description: 'Scheduling algorithms lab — FCFS, SJF, Round Robin.', start: 1, end: 6, priority: 'Medium', reminder: 'Smart',
    subtasks: [['Run experiments', false], ['Tabulate results', false], ['Write analysis', false]] },
  { title: 'Physics Problem Set 4', description: 'Chapter 6 — electromagnetic induction.', start: -4, end: -1, priority: 'Low', reminder: 'Smart',
    subtasks: [['Problems 1–5', true], ['Problems 6–10', true], ['Problems 11–14', false]] },
  { title: 'Read: Designing Data-Intensive Apps, Ch. 3', description: 'Storage and retrieval.', start: 2, end: 8, priority: 'Low', reminder: 'Weekend', subtasks: [['Notes', false], ['Summary', false]] },
  { title: 'Java Revision', description: 'Collections and generics.', start: -2, end: 0, priority: 'Medium', reminder: 'Smart', completed: true, subtasks: [['Collections', true], ['Generics', true]] },
]

export const DEFAULT_PREFERENCES = { displayName: 'Mr. Rathi', greeting: 'Welcome', defaultDuration: 3, workingHours: '6 PM – 11 PM', reminder: 'Smart' } as const

function seedDemoTasks(db: Db, today: ISODate, nowIso: string) {
  const insertTask = db.prepare(`INSERT INTO tasks (id, title, description, start_date, deadline, priority, reminder, source, source_ref, count_done, count_total, count_unit, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertSub = db.prepare('INSERT INTO subtasks (id, task_id, title, done, position, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)')
  for (const t of DEMO_TASKS) {
    const id = randomUUID()
    insertTask.run(id, t.title, t.description, addDays(today, t.start), addDays(today, t.end), t.priority, t.reminder, t.source?.[0] ?? null, t.source?.[1] ?? null,
      t.count?.done ?? null, t.count?.total ?? null, t.count?.unit ?? null, t.completed ? nowIso : null, nowIso, nowIso)
    // Seeded subtasks are marked done without a completion time: we do not know when they were done, so they
    // must not feed time-of-day insights.
    t.subtasks.forEach(([title, done], i) => insertSub.run(randomUUID(), id, title, done ? 1 : 0, i, nowIso, nowIso))
  }
}

export type InitResult = { firstRun: boolean; seeded: boolean }

/**
 * Brings the schema up to date and creates the rows MIRA needs. Demo tasks are inserted only on the very first
 * initialisation of an empty database; existing data is never overwritten and nothing is re-created on restart.
 */
export function initializeDatabase(db: Db, opts: { seed: boolean; now?: Date; timeZone?: string }): InitResult {
  migrate(db)
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  return transaction(db, () => {
    const p = DEFAULT_PREFERENCES
    db.prepare(`INSERT OR IGNORE INTO preferences (id, display_name, greeting, default_duration, working_hours, reminder, insights_since, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, NULL, ?)`).run(p.displayName, p.greeting, p.defaultDuration, p.workingHours, p.reminder, nowIso)

    const initialized = db.prepare("SELECT value FROM app_meta WHERE key = 'initialized_at'").get()
    if (initialized) return { firstRun: false, seeded: false }

    db.prepare("INSERT INTO app_meta (key, value) VALUES ('initialized_at', ?)").run(nowIso)
    // The two services with sample data start in demo mode so their screens can be explored; nothing is shown as connected.
    const insertIntegration = db.prepare('INSERT OR IGNORE INTO integrations (provider, mode, settings, updated_at) VALUES (?, ?, ?, ?)')
    insertIntegration.run('gcal', opts.seed ? 'demo' : 'disconnected', JSON.stringify({ blocks: true, deadlines: true, busy: true }), nowIso)
    insertIntegration.run('gmail', opts.seed ? 'demo' : 'disconnected', '{}', nowIso)

    const empty = (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n === 0
    const seeded = opts.seed && empty
    if (seeded) {
      seedDemoTasks(db, localDateOf(now, opts.timeZone), nowIso)
      db.prepare("INSERT INTO app_meta (key, value) VALUES ('demo_seeded_at', ?)").run(nowIso)
    }
    return { firstRun: true, seeded }
  })
}
