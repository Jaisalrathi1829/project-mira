/** Typed client for the local MIRA API. Every failure surfaces as an ApiError; nothing fails silently. */
import type {
  ApiErrorBody, ApiTask, CalendarEvent, CreateTaskInput, IntegrationStatus, MailSuggestion, Preferences, ProviderId, Reminder,
  UpdatePreferencesInput, UpdateTaskInput,
} from '../../shared/types'

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

let base = `${import.meta.env.BASE_URL ?? '/'}api`
/** Points the client at another server (used by the integration tests). */
export function configureApi(opts: { baseUrl: string }) {
  base = opts.baseUrl
}

const TIMEOUT_MS = 10_000

async function request<T>(method: string, path: string, body?: unknown, opts: { key?: string; keepalive?: boolean } = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.key ? { 'Idempotency-Key': opts.key } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      keepalive: opts.keepalive,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', ctrl.signal.aborted ? "MIRA's local server took too long to respond." : "Can't reach MIRA's local server.")
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as (T & ApiErrorBody) | null
  if (!res.ok) {
    if (data?.error) throw new ApiError(res.status, data.error.code, data.error.message)
    // A 5xx without MIRA's error body comes from the dev proxy: the API itself is not running.
    if (res.status >= 500) throw new ApiError(res.status, 'NETWORK', "Can't reach MIRA's local server.")
    throw new ApiError(res.status, `HTTP_${res.status}`, `The request failed (${res.status}).`)
  }
  if (data === null) throw new ApiError(res.status, 'BAD_RESPONSE', "MIRA's server sent an unexpected response.")
  return data
}

/** A key that makes a POST safe to retry: the server applies it once. */
export function newKey() {
  // randomUUID needs a secure context; getRandomValues does not.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b: number) => b.toString(16).padStart(2, '0')).join('')
}

type One = { task: ApiTask }
const task = (p: Promise<One>) => p.then((r) => r.task)
const enc = encodeURIComponent

export const api = {
  tasks: {
    list: () => request<{ tasks: ApiTask[] }>('GET', '/tasks').then((r) => r.tasks),
    create: (input: CreateTaskInput, key?: string) => task(request('POST', '/tasks', input, { key })),
    update: (id: string, patch: UpdateTaskInput) => task(request('PATCH', `/tasks/${enc(id)}`, patch)),
    remove: (id: string) => request<void>('DELETE', `/tasks/${enc(id)}`),
    complete: (id: string) => task(request('POST', `/tasks/${enc(id)}/complete`)),
    reopen: (id: string) => task(request('POST', `/tasks/${enc(id)}/reopen`)),
    stepCount: (id: string, by: number) => task(request('POST', `/tasks/${enc(id)}/count`, { by })),
    addSubtask: (id: string, title: string, key?: string) => task(request('POST', `/tasks/${enc(id)}/subtasks`, { title }, { key })),
    updateSubtask: (id: string, sid: string, patch: { title?: string; done?: boolean; position?: number }) => task(request('PATCH', `/tasks/${enc(id)}/subtasks/${enc(sid)}`, patch)),
    removeSubtask: (id: string, sid: string) => task(request('DELETE', `/tasks/${enc(id)}/subtasks/${enc(sid)}`)),
  },
  preferences: {
    get: () => request<{ preferences: Preferences }>('GET', '/preferences').then((r) => r.preferences),
    update: (patch: UpdatePreferencesInput, opts?: { keepalive?: boolean }) =>
      request<{ preferences: Preferences }>('PATCH', '/preferences', patch, opts).then((r) => r.preferences),
  },
  reminders: {
    pending: () => request<{ reminders: Reminder[] }>('GET', '/reminders').then((r) => r.reminders),
    ack: (keys: string[]) => request<{ recorded: number }>('POST', '/reminders/ack', { keys }),
  },
  integrations: {
    list: () => request<{ integrations: IntegrationStatus[] }>('GET', '/integrations').then((r) => r.integrations),
    connect: (id: ProviderId) => request<{ integration: IntegrationStatus }>('POST', `/integrations/${id}/connect`).then((r) => r.integration),
    disconnect: (id: ProviderId) => request<{ integration: IntegrationStatus }>('POST', `/integrations/${id}/disconnect`).then((r) => r.integration),
    updateSettings: (id: ProviderId, settings: Record<string, boolean>) =>
      request<{ integration: IntegrationStatus }>('PATCH', `/integrations/${id}/settings`, { settings }).then((r) => r.integration),
    syncCalendar: () => request<void>('POST', '/integrations/gcal/sync'),
    events: (from: string, to: string) => request<{ events: CalendarEvent[] }>('GET', `/integrations/gcal/events?from=${from}&to=${to}`).then((r) => r.events),
    suggestions: () => request<{ suggestions: MailSuggestion[] }>('GET', '/integrations/gmail/suggestions').then((r) => r.suggestions),
    importSuggestion: (id: string) => request<{ task: ApiTask; created: boolean }>('POST', `/integrations/gmail/suggestions/${enc(id)}/import`),
  },
}
