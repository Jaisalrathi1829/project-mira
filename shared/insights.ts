/**
 * Observations computed from the user's actual task history. Nothing here is a guess: each line needs a
 * minimum number of real samples, and history before `since` ("Reset learned preferences") is ignored.
 */
import { zonedParts } from './dates'
import { duration } from './engine'
import type { Task } from './types'

export const MIN_SAMPLES = 3
export const MIN_TIMED_SAMPLES = 5
const ASSIGNMENT_RE = /assign|report|project|lab/i

export const looksLikeAssignment = (title: string) => ASSIGNMENT_RE.test(title)

export type Insights = { lines: string[]; assignmentDays: number | null }

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export function computeInsights(tasks: Task[], since: string | null, timeZone?: string): Insights {
  const after = (ts: string | null): ts is string => !!ts && (!since || ts >= since)
  const lines: string[] = []

  const assignments = tasks.filter((t) => after(t.createdAt) && looksLikeAssignment(t.title)).map(duration)
  const assignmentDays = assignments.length >= MIN_SAMPLES ? Math.max(1, median(assignments)) : null
  if (assignmentDays) lines.push(`You allow about ${assignmentDays} day${assignmentDays === 1 ? '' : 's'} for assignments.`)

  const stamps = tasks.flatMap((t) => [t.completedAt, ...t.subtasks.map((s) => s.completedAt)]).filter(after)
  if (stamps.length >= MIN_TIMED_SAMPLES) {
    const hours = stamps.map((s) => zonedParts(new Date(s), timeZone).hour)
    const share = (lo: number, hi: number) => hours.filter((h) => h >= lo && h < hi).length / hours.length
    if (share(17, 24) >= 0.6) lines.push('You usually finish work in the evening.')
    else if (share(5, 12) >= 0.6) lines.push('You usually finish work in the morning.')
  }

  const ordered = tasks
    .map((t) => t.subtasks.filter((s) => s.done && after(s.completedAt)))
    .filter((subs) => subs.length >= 2 && new Set(subs.map((s) => s.completedAt)).size === subs.length)
    .map((subs) => [...subs].sort((a, b) => a.completedAt!.localeCompare(b.completedAt!)).every((s, i, arr) => !i || arr[i - 1].position < s.position))
  if (ordered.length >= MIN_SAMPLES && ordered.filter(Boolean).length / ordered.length >= 0.75) lines.push('You check off subtasks in order.')

  return { lines, assignmentDays }
}
