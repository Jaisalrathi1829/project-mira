/**
 * Work-block proposals for the Calendar: deterministic, derived only from open tasks, their deadlines and
 * the user's working hours. Blocks are suggestions inside MIRA; nothing is written to an external calendar.
 */
import { Clock, ISODate } from './dates'
import { progress } from './engine'
import type { Priority, Task } from './types'

export type WorkBlock = { date: ISODate; from: number; to: number; taskId: string; label: string }

const LENGTH: Record<Priority, number> = { High: 2.5, Medium: 2, Low: 1.5 }
const RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 }
const GAP = 0.5

export function nextStepLabel(t: Task) {
  if (t.count) return `${Math.max(0, t.count.total - t.count.done)} ${t.count.unit} left`
  return t.subtasks.find((s) => !s.done)?.title ?? 'Focus session'
}

export function planWorkBlocks(tasks: Task[], hours: [number, number], days: ISODate[], clock: Clock): WorkBlock[] {
  const [h0, h1] = hours
  const perDay = h1 - h0 > 6 ? 2 : 1
  const blocks: WorkBlock[] = []
  for (const date of days) {
    if (date < clock.today) continue
    let from = date === clock.today ? Math.max(h0, Math.ceil(clock.hour * 2) / 2) : h0
    const candidates = tasks
      .filter((t) => !t.completed && t.startDate <= date && t.deadline >= date && progress(t) < 1)
      .sort((a, b) => a.deadline.localeCompare(b.deadline) || RANK[a.priority] - RANK[b.priority] || a.createdAt.localeCompare(b.createdAt))
      .slice(0, perDay)
    for (const t of candidates) {
      const to = Math.min(h1, from + LENGTH[t.priority])
      if (to - from < 1) break
      blocks.push({ date, from, to, taskId: t.id, label: nextStepLabel(t) })
      from = to + GAP
    }
  }
  return blocks
}
