import type { Clock } from '../shared/dates'
import type { Subtask, Task } from '../shared/types'

/** A clock at `today`, `dayFraction` of the way through the day (0.6 ≈ 2:24 PM, the prototype's "now"). */
export const at = (today: string, dayFraction = 0.6): Clock => ({ today, dayFraction, hour: dayFraction * 24 })

export function subs(...done: boolean[]): Subtask[] {
  return done.map((d, i) => ({ id: `s${i}`, title: `Step ${i + 1}`, done: d, position: i, completedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }))
}

export function task(p: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'Task', description: '', startDate: '2026-10-07', deadline: '2026-10-10', durationDays: 3, priority: 'Medium', reminder: 'Smart',
    source: null, sourceRef: null, count: null, completed: false, completedAt: null, subtasks: [],
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...p,
  }
}
