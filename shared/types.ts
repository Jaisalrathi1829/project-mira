/** Data contracts shared by the MIRA API and the frontend. */
import type { ISODate } from './dates'

export const PRIORITIES = ['Low', 'Medium', 'High'] as const
export type Priority = (typeof PRIORITIES)[number]

export const REMINDER_PREFERENCES = ['Minimal', 'Smart', 'Frequent'] as const
export type ReminderPreference = (typeof REMINDER_PREFERENCES)[number]
/** A task may also be limited to evenings or weekends. */
export const TASK_REMINDERS = [...REMINDER_PREFERENCES, 'Evening', 'Weekend'] as const
export type TaskReminder = (typeof TASK_REMINDERS)[number]

export const GREETINGS = ['Welcome', 'Welcome back', 'Good evening'] as const
export type Greeting = (typeof GREETINGS)[number]

export const WORKING_HOURS = ['9 AM – 5 PM', '2 PM – 8 PM', '6 PM – 11 PM'] as const
export type WorkingHours = (typeof WORKING_HOURS)[number]
export const WORKING_HOUR_RANGES: Record<WorkingHours, [number, number]> = {
  '9 AM – 5 PM': [9, 17],
  '2 PM – 8 PM': [14, 20],
  '6 PM – 11 PM': [18, 23],
}

export const STATUSES = ['Upcoming', 'Active', 'At Risk', 'Due Today', 'Overdue', 'Completed'] as const
export type Status = (typeof STATUSES)[number]

export type Subtask = {
  id: string
  title: string
  done: boolean
  position: number
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CountProgress = { done: number; total: number; unit: string }

export type Task = {
  id: string
  title: string
  description: string
  startDate: ISODate
  deadline: ISODate
  /** Calendar days from start date to deadline (7 → 10 October is 3). Derived, never stored. */
  durationDays: number
  priority: Priority
  reminder: TaskReminder
  source: string | null
  sourceRef: string | null
  count: CountProgress | null
  completed: boolean
  /** ISO timestamp, set once when the task is completed and cleared when it is reopened. */
  completedAt: string | null
  subtasks: Subtask[]
  createdAt: string
  updatedAt: string
}

/** Server-side evaluation included in API responses for non-UI clients. The UI re-evaluates with its own live clock. */
export type TaskEvaluation = { status: Status; progress: number; expectedProgress: number; asOf: ISODate }
export type ApiTask = Task & { computed: TaskEvaluation }

export type Preferences = {
  displayName: string
  greeting: Greeting
  defaultDuration: number
  workingHours: WorkingHours
  reminder: ReminderPreference
  /** Insights only consider history after this moment ("Reset learned preferences"). */
  insightsSince: string | null
  updatedAt: string
}

export type CreateTaskInput = {
  title: string
  description?: string
  startDate?: ISODate
  deadline?: ISODate
  durationDays?: number
  priority?: Priority
  reminder?: TaskReminder
  subtasks?: string[]
  count?: CountProgress
  source?: string
  sourceRef?: string
}

export type UpdateTaskInput = Partial<{
  title: string
  description: string
  startDate: ISODate
  deadline: ISODate
  durationDays: number
  priority: Priority
  reminder: TaskReminder
  count: CountProgress | null
}>

export type UpdatePreferencesInput = Partial<Omit<Preferences, 'updatedAt' | 'insightsSince'>> & { resetInsights?: boolean }

/* ---------- Integrations ---------- */

export const PROVIDER_IDS = ['gcal', 'gmail', 'notion', 'slack', 'github', 'drive', 'outlook'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

/**
 * `connected` is reserved for a real, authorised account. Until OAuth is implemented a provider can only be
 * `disconnected` or, where sample data exists, running in `demo` mode.
 */
export type ConnectionMode = 'disconnected' | 'demo' | 'connected'

export type IntegrationStatus = {
  id: ProviderId
  name: string
  mode: ConnectionMode
  /** Whether a demo data set exists for this provider. */
  demoAvailable: boolean
  /** Whether real OAuth credentials are configured on the server (the OAuth flow itself is not implemented yet). */
  credentialsConfigured: boolean
  account: string | null
  lastSyncedAt: string | null
  settings: Record<string, boolean>
}

export type MailSuggestion = {
  id: string
  from: string
  subject: string
  snippet: string
  kind: 'Deadline' | 'Request' | 'Follow-up'
  /** Detected deadline, if any. */
  deadline: ISODate | null
  /** Task id when this message has already been imported. */
  importedTaskId: string | null
}

export type CalendarEvent = {
  id: string
  date: ISODate
  /** Hours from midnight, e.g. 10.5 = 10:30. */
  from: number
  to: number
  title: string
  source: 'demo' | 'google'
}

/* ---------- Reminders ---------- */

export type ReminderKind = 'starts-today' | 'due-tomorrow' | 'due-today' | 'overdue' | 'at-risk'
export type Reminder = {
  /** Stable identity used to avoid delivering the same reminder twice. */
  key: string
  taskId: string
  kind: ReminderKind
  date: ISODate
  title: string
  message: string
}

/* ---------- Errors ---------- */

export type ApiErrorCode = 'BAD_REQUEST' | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_IMPLEMENTED' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL'
export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; details?: { path: string; message: string }[] } }
