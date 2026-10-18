import { randomUUID } from 'node:crypto'
import { durationDays } from '../../shared/engine'
import type { CountProgress, Priority, Subtask, Task, TaskReminder } from '../../shared/types'
import type { Db } from '../db/database'

type TaskRow = {
  id: string; title: string; description: string; start_date: string; deadline: string; priority: Priority; reminder: TaskReminder
  source: string | null; source_ref: string | null; count_done: number | null; count_total: number | null; count_unit: string | null
  completed_at: string | null; created_at: string; updated_at: string
}
type SubtaskRow = { id: string; task_id: string; title: string; done: number; position: number; completed_at: string | null; created_at: string; updated_at: string }

export type TaskRecord = {
  title: string; description: string; startDate: string; deadline: string; priority: Priority; reminder: TaskReminder
  source: string | null; sourceRef: string | null; count: CountProgress | null; completedAt: string | null
}

const COLUMNS: Record<Exclude<keyof TaskRecord, 'count'>, string> = {
  title: 'title', description: 'description', startDate: 'start_date', deadline: 'deadline', priority: 'priority', reminder: 'reminder',
  source: 'source', sourceRef: 'source_ref', completedAt: 'completed_at',
}

const toSubtask = (r: SubtaskRow): Subtask => ({
  id: r.id, title: r.title, done: r.done === 1, position: r.position, completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at,
})

function toTask(r: TaskRow, subtasks: Subtask[]): Task {
  return {
    id: r.id, title: r.title, description: r.description, startDate: r.start_date, deadline: r.deadline,
    durationDays: durationDays(r.start_date, r.deadline), priority: r.priority, reminder: r.reminder,
    source: r.source, sourceRef: r.source_ref,
    count: r.count_total === null ? null : { done: r.count_done ?? 0, total: r.count_total, unit: r.count_unit ?? '' },
    completed: r.completed_at !== null, completedAt: r.completed_at, subtasks, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export class TaskRepository {
  private readonly stmts
  constructor(private readonly db: Db) {
    this.stmts = {
      all: db.prepare('SELECT * FROM tasks'),
      allSubs: db.prepare('SELECT * FROM subtasks ORDER BY task_id, position'),
      get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
      subsOf: db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position'),
      bySource: db.prepare('SELECT id FROM tasks WHERE source = ? AND source_ref = ?'),
      insert: db.prepare(`INSERT INTO tasks (id, title, description, start_date, deadline, priority, reminder, source, source_ref, count_done, count_total, count_unit, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      delete: db.prepare('DELETE FROM tasks WHERE id = ?'),
      touch: db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?'),
      stepCount: db.prepare('UPDATE tasks SET count_done = MIN(count_total, MAX(0, count_done + ?)), updated_at = ? WHERE id = ? AND count_total IS NOT NULL'),
      getSub: db.prepare('SELECT * FROM subtasks WHERE id = ? AND task_id = ?'),
      nextPos: db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM subtasks WHERE task_id = ?'),
      insertSub: db.prepare('INSERT INTO subtasks (id, task_id, title, done, position, completed_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, NULL, ?, ?)'),
      deleteSub: db.prepare('DELETE FROM subtasks WHERE id = ? AND task_id = ?'),
      setPos: db.prepare('UPDATE subtasks SET position = ? WHERE id = ?'),
    }
  }

  list(): Task[] {
    const subs = new Map<string, Subtask[]>()
    for (const r of this.stmts.allSubs.all() as SubtaskRow[]) {
      const arr = subs.get(r.task_id) ?? []
      arr.push(toSubtask(r))
      subs.set(r.task_id, arr)
    }
    return (this.stmts.all.all() as TaskRow[]).map((r) => toTask(r, subs.get(r.id) ?? []))
  }

  get(id: string): Task | null {
    const row = this.stmts.get.get(id) as TaskRow | undefined
    return row ? toTask(row, (this.stmts.subsOf.all(id) as SubtaskRow[]).map(toSubtask)) : null
  }

  findBySource(source: string, sourceRef: string): Task | null {
    const row = this.stmts.bySource.get(source, sourceRef) as { id: string } | undefined
    return row ? this.get(row.id) : null
  }

  insert(rec: TaskRecord, subtaskTitles: string[], at: string): string {
    const id = randomUUID()
    this.stmts.insert.run(id, rec.title, rec.description, rec.startDate, rec.deadline, rec.priority, rec.reminder, rec.source, rec.sourceRef,
      rec.count?.done ?? null, rec.count?.total ?? null, rec.count?.unit ?? null, rec.completedAt, at, at)
    subtaskTitles.forEach((title) => this.insertSubtask(id, title, at))
    return id
  }

  update(id: string, fields: Partial<TaskRecord>, at: string): boolean {
    const sets: string[] = []
    const values: (string | number | null)[] = []
    for (const [key, value] of Object.entries(fields) as [keyof TaskRecord, unknown][]) {
      if (value === undefined) continue
      if (key === 'count') {
        const c = value as CountProgress | null
        sets.push('count_done = ?', 'count_total = ?', 'count_unit = ?')
        values.push(c?.done ?? null, c?.total ?? null, c?.unit ?? null)
      } else {
        sets.push(`${COLUMNS[key]} = ?`)
        values.push(value as string | null)
      }
    }
    sets.push('updated_at = ?')
    values.push(at, id)
    return this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values).changes > 0
  }

  delete(id: string) {
    return this.stmts.delete.run(id).changes > 0
  }

  touch(id: string, at: string) {
    this.stmts.touch.run(at, id)
  }

  /** Moves a count by `by`, clamped to 0…total in a single statement. */
  stepCount(id: string, by: number, at: string) {
    return this.stmts.stepCount.run(by, at, id).changes > 0
  }

  getSubtask(taskId: string, subtaskId: string): Subtask | null {
    const row = this.stmts.getSub.get(subtaskId, taskId) as SubtaskRow | undefined
    return row ? toSubtask(row) : null
  }

  insertSubtask(taskId: string, title: string, at: string): string {
    const id = randomUUID()
    const { pos } = this.stmts.nextPos.get(taskId) as { pos: number }
    this.stmts.insertSub.run(id, taskId, title, pos, at, at)
    return id
  }

  updateSubtask(taskId: string, subtaskId: string, fields: { title?: string; done?: boolean; completedAt?: string | null }, at: string) {
    const sets: string[] = []
    const values: (string | number | null)[] = []
    if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title) }
    if (fields.done !== undefined) { sets.push('done = ?', 'completed_at = ?'); values.push(fields.done ? 1 : 0, fields.completedAt ?? null) }
    sets.push('updated_at = ?')
    values.push(at, subtaskId, taskId)
    return this.db.prepare(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = ? AND task_id = ?`).run(...values).changes > 0
  }

  deleteSubtask(taskId: string, subtaskId: string) {
    return this.stmts.deleteSub.run(subtaskId, taskId).changes > 0
  }

  /** Re-numbers positions 0…n-1, optionally moving one subtask to a new index. */
  reorderSubtasks(taskId: string, move?: { id: string; to: number }) {
    const ids = (this.stmts.subsOf.all(taskId) as SubtaskRow[]).map((r) => r.id)
    if (move) {
      const from = ids.indexOf(move.id)
      if (from >= 0) { ids.splice(from, 1); ids.splice(Math.max(0, Math.min(ids.length, move.to)), 0, move.id) }
    }
    ids.forEach((id, i) => this.stmts.setPos.run(i, id))
  }
}
