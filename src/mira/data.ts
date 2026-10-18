/**
 * The UI's view of the task engine: the shared rules in /shared, evaluated against the browser's live clock.
 * Every screen reads status, progress and dates through these helpers so they always agree.
 */
import { Clock, ISODate, clockAt, shortDate, weekdayName, yearOf } from '../../shared/dates'
import * as engine from '../../shared/engine'
import type { Task } from '../../shared/types'

export type { Priority, Status, Subtask as Sub, Task } from '../../shared/types'
export type { ISODate } from '../../shared/dates'

let snapshot: { at: number; clock: Clock } | null = null
/** "Now", re-read at most once a second so one render sees one consistent moment. */
export function clock(): Clock {
  const at = Date.now()
  if (!snapshot || at - snapshot.at > 1000) snapshot = { at, clock: clockAt(new Date(at)) }
  return snapshot.clock
}
export const today = () => clock().today

export const weekday = (d: ISODate) => weekdayName(d)
export const fmt = (d: ISODate) => shortDate(d, yearOf(today()))
export const days = (n: number) => engine.plural(n, 'day')

export const progress = engine.progress
export const duration = engine.duration
export const progressText = engine.progressText
export const remaining = (t: Task) => engine.remaining(t, clock())
/** Where progress should be by now if work were spread evenly across the window. */
export const expected = (t: Task) => engine.expected(t, clock())
export const status = (t: Task) => engine.status(t, clock())
export const dueText = (t: Task) => engine.dueText(t, clock())
export const completedOn = (t: Task) => engine.completedOn(t)
export const focusTask = (tasks: Task[]) => engine.pickFocus(tasks, clock())
