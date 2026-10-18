/**
 * The one authoritative copy of MIRA's data in the UI. State changes only after the server confirms them, and the
 * confirmed record from the server replaces the local one, so every screen shows what is actually stored.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultCompare } from '../../shared/engine'
import type { ConnectionMode, CreateTaskInput, IntegrationStatus, Preferences, ProviderId, Reminder, Task, UpdatePreferencesInput, UpdateTaskInput } from '../../shared/types'
import { ApiError, api } from './api'

export type Phase = 'loading' | 'ready' | 'error'
export type Services = Record<string, ConnectionMode>

const PREF_FIELDS = ['displayName', 'greeting', 'defaultDuration', 'workingHours', 'reminder'] as const
const REMINDER_POLL_MS = 60_000

const sortTasks = (ts: Task[]) => [...ts].sort(defaultCompare)
export const errorMessage = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')

export function useMira() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [prefs, setPrefsState] = useState<Preferences | null>(null)
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const inflight = useRef(new Set<string>())

  const load = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    try {
      const [t, p, i] = await Promise.all([api.tasks.list(), api.preferences.get(), api.integrations.list()])
      setTasks(sortTasks(t))
      setPrefsState(p)
      saved.current = p
      setIntegrations(i)
      setPhase('ready')
    } catch (e) {
      setLoadError(errorMessage(e))
      setPhase('error')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  /** Runs a server call at most once at a time per key; failures are reported, never swallowed. */
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (inflight.current.has(key)) return undefined
    inflight.current.add(key)
    setBusy(new Set(inflight.current))
    try {
      return await fn()
    } catch (e) {
      setNotice(errorMessage(e))
      return undefined
    } finally {
      inflight.current.delete(key)
      setBusy(new Set(inflight.current))
    }
  }, [])

  const put = useCallback((t: Task) => {
    setTasks((ts) => sortTasks(ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]))
    return t
  }, [])

  /* ---------- Tasks ---------- */
  const taskActions = useMemo(() => ({
    create: (input: CreateTaskInput, key: string) => run('create', () => api.tasks.create(input, key).then(put)),
    update: (id: string, patch: UpdateTaskInput) => run(`task:${id}`, () => api.tasks.update(id, patch).then(put)),
    remove: (id: string) => run(`task:${id}`, async () => {
      await api.tasks.remove(id)
      setTasks((ts) => ts.filter((t) => t.id !== id))
      return true
    }),
    /** Completes or reopens; resolves to the stored task. */
    toggle: (t: Task) => run(`task:${t.id}`, () => (t.completed ? api.tasks.reopen(t.id) : api.tasks.complete(t.id)).then(put)),
    stepCount: (id: string, by: number) => run(`task:${id}`, () => api.tasks.stepCount(id, by).then(put)),
    addSubtask: (id: string, title: string, key: string) => run(`subtasks:${id}`, () => api.tasks.addSubtask(id, title, key).then(put)),
    updateSubtask: (id: string, sid: string, patch: { title?: string; done?: boolean }) => run(`sub:${sid}`, () => api.tasks.updateSubtask(id, sid, patch).then(put)),
    removeSubtask: (id: string, sid: string) => run(`sub:${sid}`, () => api.tasks.removeSubtask(id, sid).then(put)),
  }), [run, put])

  /* ---------- Preferences: edited locally, saved shortly after the last change ---------- */
  const saved = useRef<Preferences | null>(null)
  const pending = useRef<UpdatePreferencesInput>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chain = useRef(Promise.resolve())

  const flushPrefs = useCallback(() => {
    clearTimeout(timer.current)
    chain.current = chain.current.then(async () => {
      const patch = pending.current
      if (!Object.keys(patch).length) return
      pending.current = {}
      try {
        const p = await api.preferences.update(patch)
        saved.current = p
        setPrefsState((cur) => {
          if (!cur) return p
          const next = { ...p }
          // Keep fields the user has changed again since this save, and their in-progress spacing.
          for (const k of PREF_FIELDS) if (k in pending.current) (next as Record<string, unknown>)[k] = cur[k]
          if (cur.displayName.trim() === p.displayName) next.displayName = cur.displayName
          return next
        })
      } catch (e) {
        pending.current = {}
        setPrefsState(saved.current)
        setNotice(`Your preferences were not saved. ${errorMessage(e)}`)
      }
    })
    return chain.current
  }, [])

  const updatePrefs = useCallback((next: Preferences) => {
    setPrefsState(next)
    const base = saved.current
    if (!base) return
    const patch: Record<string, unknown> = {}
    for (const k of PREF_FIELDS) {
      const v = k === 'displayName' ? next.displayName.trim() : next[k]
      if (v !== base[k]) patch[k] = v
    }
    if (patch.displayName === '') delete patch.displayName
    pending.current = patch as UpdatePreferencesInput
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushPrefs(), 400)
  }, [flushPrefs])

  const resetInsights = useCallback(() => run('prefs:reset', async () => {
    const p = await api.preferences.update({ resetInsights: true })
    saved.current = p
    setPrefsState((cur) => (cur ? { ...cur, insightsSince: p.insightsSince } : p))
  }), [run])

  useEffect(() => {
    const onHide = () => {
      if (Object.keys(pending.current).length) void api.preferences.update(pending.current, { keepalive: true }).catch(() => undefined)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  /* ---------- Reminders (in-app, while MIRA is open) ---------- */
  const pollReminders = useCallback(async () => {
    try {
      setReminders(await api.reminders.pending())
    } catch {
      // A missed poll is retried on the next interval; the load error banner covers a server that is down.
    }
  }, [])
  useEffect(() => {
    if (phase !== 'ready') return
    void pollReminders()
    const id = setInterval(() => void pollReminders(), REMINDER_POLL_MS)
    return () => clearInterval(id)
  }, [phase, pollReminders])
  const ackReminder = useCallback((key: string) => {
    setReminders((rs) => rs.filter((r) => r.key !== key))
    void api.reminders.ack([key]).catch((e) => setNotice(errorMessage(e)))
  }, [])

  /* ---------- Integrations ---------- */
  const services: Services = useMemo(() => Object.fromEntries(integrations.map((i) => [i.id, i.mode])), [integrations])
  const putIntegration = (i: IntegrationStatus) => setIntegrations((all) => all.map((x) => (x.id === i.id ? i : x)))
  const integrationActions = useMemo(() => ({
    toggle: (id: ProviderId) => run(`integration:${id}`, async () => {
      const current = integrations.find((i) => i.id === id)
      putIntegration(await (current && current.mode !== 'disconnected' ? api.integrations.disconnect(id) : api.integrations.connect(id)))
    }),
    updateSettings: (id: ProviderId, settings: Record<string, boolean>) => run(`integration:${id}`, async () => putIntegration(await api.integrations.updateSettings(id, settings))),
    importSuggestion: (messageId: string) => run(`import:${messageId}`, async () => put((await api.integrations.importSuggestion(messageId)).task)),
  }), [run, put, integrations])

  return {
    phase, loadError, reload: load, tasks, prefs, updatePrefs, flushPrefs, resetInsights, integrations, services,
    reminders, ackReminder, notice, dismissNotice: () => setNotice(null), report: setNotice, busy,
    task: taskActions, integration: integrationActions,
  }
}

export type Mira = ReturnType<typeof useMira>
