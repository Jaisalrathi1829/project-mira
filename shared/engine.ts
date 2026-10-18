/**
 * MIRA task engine — the single definition of progress, pace and status, used by the API and the UI.
 *
 * Definitions
 * - Duration: calendar days from start date to deadline. 7 → 10 October is a 3-day window.
 * - Progress: completed tasks are 100%; count-based tasks use done / total; otherwise the share of
 *   subtasks done (0 when there are none).
 * - Expected progress (the pace marker): the share of the window that has elapsed, measured from
 *   00:00 on the start date to 00:00 on the deadline, using the local time of day:
 *       clamp((days since start + fraction of today elapsed) / max(1, duration), 0, 1)
 *   It reaches 100% on the deadline day itself, which is "Due Today".
 * - Status precedence: Completed → Overdue (deadline before today) → Due Today → Upcoming (starts
 *   after today) → At Risk (expected − actual progress > 25 points) → Active.
 */
import { Clock, ISODate, addDays, diffDays, localDateOf, shortDate, weekdayName, yearOf } from './dates'
import type { Priority, Status, Task } from './types'

export const AT_RISK_GAP = 0.25
const EPSILON = 1e-9

type Timed = Pick<Task, 'startDate' | 'deadline'>
type Progressable = Pick<Task, 'completed' | 'count' | 'subtasks'>
type Evaluable = Timed & Progressable

export const durationDays = (startDate: ISODate, deadline: ISODate) => diffDays(startDate, deadline)
export const duration = (t: Timed) => durationDays(t.startDate, t.deadline)

export function progress(t: Progressable) {
  if (t.completed) return 1
  if (t.count) return t.count.total > 0 ? Math.min(1, Math.max(0, t.count.done / t.count.total)) : 0
  if (!t.subtasks.length) return 0
  return t.subtasks.filter((s) => s.done).length / t.subtasks.length
}

/** Days until the deadline; negative once overdue. */
export const remaining = (t: Timed, clock: Clock) => diffDays(clock.today, t.deadline)

/** How far through the task's window "now" is, 0–1. Also where progress should be if work were spread evenly. */
export function expected(t: Timed, clock: Clock) {
  const elapsed = diffDays(t.startDate, clock.today) + clock.dayFraction
  return Math.min(1, Math.max(0, elapsed / Math.max(1, duration(t))))
}

export function status(t: Evaluable, clock: Clock): Status {
  if (t.completed) return 'Completed'
  if (t.deadline < clock.today) return 'Overdue'
  if (t.deadline === clock.today) return 'Due Today'
  if (t.startDate > clock.today) return 'Upcoming'
  if (expected(t, clock) - progress(t) > AT_RISK_GAP + EPSILON) return 'At Risk'
  return 'Active'
}

/** The user's calendar day on which the task was completed. */
export function completedOn(t: Pick<Task, 'completedAt'>, timeZone?: string): ISODate | null {
  return t.completedAt ? localDateOf(new Date(t.completedAt), timeZone) : null
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function dueText(t: Evaluable & Pick<Task, 'completedAt'>, clock: Clock) {
  const year = yearOf(clock.today)
  if (t.completed) {
    const on = completedOn(t)
    return on === clock.today ? 'Completed today' : `Completed ${shortDate(on ?? t.deadline, year)}`
  }
  const r = remaining(t, clock)
  if (r < 0) return `Overdue by ${plural(-r, 'day')}`
  if (r === 0) return 'Due today'
  if (t.startDate > clock.today) return `Starts ${weekdayName(t.startDate)} ${shortDate(t.startDate, year)}`
  return `Due in ${plural(r, 'day')}`
}

export function progressText(t: Progressable) {
  if (t.count) return `${t.count.done} / ${t.count.total} ${t.count.unit}`
  return `${Math.round(progress(t) * 100)}% complete`
}

const URGENCY: Status[] = ['Overdue', 'Due Today', 'At Risk', 'Active', 'Upcoming', 'Completed']
export const urgency = (t: Evaluable, clock: Clock) => URGENCY.indexOf(status(t, clock))
const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 }

/**
 * The task to focus on now: among incomplete tasks that have started, the highest priority, then the most
 * urgent status, then the earliest deadline. Returns undefined when nothing is in progress.
 */
export function pickFocus<T extends Evaluable & Pick<Task, 'priority' | 'createdAt'>>(tasks: T[], clock: Clock): T | undefined {
  return tasks
    .filter((t) => !t.completed && t.startDate <= clock.today)
    .sort((a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      urgency(a, clock) - urgency(b, clock) ||
      a.deadline.localeCompare(b.deadline) ||
      a.createdAt.localeCompare(b.createdAt))[0]
}

/* ---------- Filtering and sorting (shared by GET /api/tasks and the UI) ---------- */

export const SORT_KEYS = ['deadline', 'startDate', 'priority', 'createdAt', 'updatedAt', 'completedAt', 'title'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type TaskQuery = { status?: Status[]; completed?: boolean; q?: string; sort?: SortKey; order?: 'asc' | 'desc' }

export function compareBy(key: SortKey) {
  return (a: Task, b: Task) => {
    switch (key) {
      case 'priority': return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      case 'title': return a.title.localeCompare(b.title)
      case 'completedAt': return (a.completedAt ?? '').localeCompare(b.completedAt ?? '')
      default: return a[key].localeCompare(b[key])
    }
  }
}

/** Default order: earliest deadline first, then priority, then creation. */
export function defaultCompare(a: Task, b: Task) {
  return compareBy('deadline')(a, b) || compareBy('priority')(a, b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export function queryTasks(tasks: Task[], query: TaskQuery, clock: Clock) {
  const q = query.q?.trim().toLowerCase()
  const list = tasks.filter((t) =>
    (query.completed === undefined || t.completed === query.completed) &&
    (!query.status?.length || query.status.includes(status(t, clock))) &&
    (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)))
  const dir = query.order === 'desc' ? -1 : 1
  const cmp = query.sort ? compareBy(query.sort) : defaultCompare
  return list.sort((a, b) => dir * cmp(a, b) || defaultCompare(a, b))
}

export function evaluate(t: Task, clock: Clock) {
  return { status: status(t, clock), progress: progress(t), expectedProgress: expected(t, clock), asOf: clock.today }
}

/** Days in a window, inclusive. */
export function daysBetween(from: ISODate, to: ISODate): ISODate[] {
  const n = diffDays(from, to)
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i))
}
