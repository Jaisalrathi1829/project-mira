import { z } from 'zod'
import { isISODate } from '../../shared/dates'
import { SORT_KEYS } from '../../shared/engine'
import { GREETINGS, PRIORITIES, PROVIDER_IDS, REMINDER_PREFERENCES, STATUSES, TASK_REMINDERS, WORKING_HOURS } from '../../shared/types'

export const isoDate = z.string().refine((v) => isISODate(v) && +v.slice(0, 4) >= 1900 && +v.slice(0, 4) <= 2999, 'Expected a calendar date in YYYY-MM-DD format')
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id')
const title = z.string().trim().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer')
const description = z.string().max(5000, 'Description must be 5000 characters or fewer')
const durationDays = z.int().min(0).max(3650)

const count = z.strictObject({
  done: z.int().min(0),
  total: z.int().min(1).max(100_000),
  unit: z.string().trim().min(1).max(40),
}).refine((c) => c.done <= c.total, { message: 'done cannot exceed total', path: ['done'] })

const notBoth = (v: { deadline?: unknown; durationDays?: unknown }) => !(v.deadline !== undefined && v.durationDays !== undefined)
const notBothMsg = { message: 'Provide either deadline or durationDays, not both', path: ['durationDays'] }

export const createTask = z.strictObject({
  title,
  description: description.optional(),
  startDate: isoDate.optional(),
  deadline: isoDate.optional(),
  durationDays: durationDays.optional(),
  priority: z.enum(PRIORITIES).optional(),
  reminder: z.enum(TASK_REMINDERS).optional(),
  subtasks: z.array(title).max(100).optional(),
  count: count.optional(),
  source: z.string().trim().min(1).max(40).optional(),
  sourceRef: z.string().trim().min(1).max(200).optional(),
}).refine(notBoth, notBothMsg).refine((v) => !v.sourceRef || v.source, { message: 'sourceRef requires source', path: ['sourceRef'] })

export const updateTask = z.strictObject({
  title: title.optional(),
  description: description.optional(),
  startDate: isoDate.optional(),
  deadline: isoDate.optional(),
  durationDays: durationDays.optional(),
  priority: z.enum(PRIORITIES).optional(),
  reminder: z.enum(TASK_REMINDERS).optional(),
  count: count.nullable().optional(),
}).refine(notBoth, notBothMsg).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update')

export const stepCount = z.strictObject({ by: z.int().min(-1000).max(1000).refine((n) => n !== 0, 'by must not be 0') })

export const createSubtask = z.strictObject({ title })
export const updateSubtask = z.strictObject({
  title: title.optional(),
  done: z.boolean().optional(),
  position: z.int().min(0).max(1000).optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update')

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(values)))

export const taskQuery = z.strictObject({
  status: csv(STATUSES).optional(),
  completed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(SORT_KEYS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  today: isoDate.optional(),
})
export const todayQuery = z.strictObject({ today: isoDate.optional() })

export const updatePreferences = z.strictObject({
  displayName: z.string().trim().min(1, 'Name is required').max(80),
  greeting: z.enum(GREETINGS),
  defaultDuration: z.int().min(1).max(60),
  workingHours: z.enum(WORKING_HOURS),
  reminder: z.enum(REMINDER_PREFERENCES),
  resetInsights: z.literal(true),
}).partial().refine((v) => Object.keys(v).length > 0, 'Provide at least one preference to update')

export const ackReminders = z.strictObject({ keys: z.array(z.string().max(120)).min(1).max(200) })

export const provider = z.enum(PROVIDER_IDS)
export const integrationSettings = z.strictObject({ settings: z.record(z.string().max(40), z.boolean()) })
export const eventRange = z.strictObject({ from: isoDate, to: isoDate })
