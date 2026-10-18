/**
 * Deadline-aware reminder rules. Pure and clock-driven so they can be tested and scheduled anywhere.
 *
 * Policies (a task's own reminder setting; the global preference "Minimal" caps every task to Minimal):
 * - Minimal:  due today; overdue (once per deadline)
 * - Smart:    Minimal + due tomorrow + falling behind pace (once per task window)
 * - Frequent: Smart + starts today; overdue and behind-pace repeat daily
 * - Evening:  Smart, delivered from 6 PM local time
 * - Weekend:  Smart on Saturdays and Sundays; "due today" is always delivered
 * Completed tasks never produce reminders. Each reminder has a stable key so a delivery log can
 * guarantee it is shown once.
 */
import { Clock, addDays, isWeekend, shortDate } from './dates'
import { expected, progress, status } from './engine'
import type { Reminder, ReminderKind, ReminderPreference, Task, TaskReminder } from './types'

const ORDER: ReminderKind[] = ['overdue', 'due-today', 'due-tomorrow', 'at-risk', 'starts-today']
export const EVENING_HOUR = 18

export function effectivePolicy(task: TaskReminder, global: ReminderPreference): TaskReminder {
  return global === 'Minimal' ? 'Minimal' : task
}

function message(kind: ReminderKind, t: Task, clock: Clock) {
  switch (kind) {
    case 'due-today': return 'This is due today.'
    case 'due-tomorrow': return 'This is due tomorrow.'
    case 'starts-today': return 'This starts today.'
    case 'overdue': return `This was due ${shortDate(t.deadline)}.`
    case 'at-risk': return `Behind pace — ${Math.round(progress(t) * 100)}% done, ${Math.round(expected(t, clock) * 100)}% expected.`
  }
}

export function remindersFor(t: Task, global: ReminderPreference, clock: Clock): Reminder[] {
  if (t.completed) return []
  const policy = effectivePolicy(t.reminder, global)
  if (policy === 'Evening' && clock.hour < EVENING_HOUR) return []
  const weekendOnly = policy === 'Weekend' && !isWeekend(clock.today)
  const level = policy === 'Minimal' ? 0 : policy === 'Frequent' ? 2 : 1
  const st = status(t, clock)
  const out: [ReminderKind, string][] = []

  if (st === 'Due Today') out.push(['due-today', t.deadline])
  if (!weekendOnly) {
    if (st === 'Overdue') out.push(['overdue', level === 2 ? clock.today : t.deadline])
    if (level >= 1 && t.deadline === addDays(clock.today, 1)) out.push(['due-tomorrow', t.deadline])
    if (level >= 1 && st === 'At Risk') out.push(['at-risk', level === 2 ? clock.today : `${t.startDate}~${t.deadline}`])
    if (level >= 2 && t.startDate === clock.today && st !== 'Due Today') out.push(['starts-today', t.startDate])
  }
  return out.map(([kind, anchor]) => ({
    key: `${t.id}:${kind}:${anchor}`, taskId: t.id, kind, date: clock.today, title: t.title, message: message(kind, t, clock),
  }))
}

/** Every reminder that applies right now, most pressing first. */
export function computeReminders(tasks: Task[], global: ReminderPreference, clock: Clock): Reminder[] {
  return tasks
    .flatMap((t) => remindersFor(t, global, clock))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.title.localeCompare(b.title))
}

/** Reminders not yet delivered, given the keys already recorded in the delivery log. */
export function pendingReminders(tasks: Task[], global: ReminderPreference, clock: Clock, delivered: Set<string>) {
  return computeReminders(tasks, global, clock).filter((r) => !delivered.has(r.key))
}
