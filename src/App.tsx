import { useEffect, useMemo, useState } from 'react'
import { Task, clock, status, today } from './mira/data'
import { Today, TaskList, Detail, Timeline } from './mira/screens'
import AddTask from './mira/AddTask'
import { Calendar, Settings, Companion, QuickAdd, CState, Done } from './mira/extra'
import { IToday, ITasks, ITimeline, ICal, IDone, ISettings } from './mira/icons'
import { Btn, Notice } from './mira/ui'
import { useMira } from './mira/store'
import { newKey } from './mira/api'
import { addDays } from '../shared/dates'
import { computeInsights } from '../shared/insights'
import { computeReminders } from '../shared/reminders'
import type { Reminder } from '../shared/types'

type Page = 'today' | 'tasks' | 'timeline' | 'calendar' | 'completed' | 'settings'
const NAV: [Page, string, () => React.ReactNode][] = [
  ['today', 'Today', IToday], ['tasks', 'Tasks', ITasks], ['timeline', 'Timeline', ITimeline], ['calendar', 'Calendar', ICal], ['completed', 'Completed', IDone],
]

export default function App() {
  const m = useMira()
  const { tasks, prefs } = m
  const [page, setPage] = useState<Page>('today')
  const [detail, setDetail] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [quick, setQuick] = useState(false)
  const [comp, setComp] = useState<CState | null>('welcome')
  const [done, setDone] = useState<Done | null>(null)
  const [shownReminder, setShownReminder] = useState<Reminder | null>(null)
  const [, setTick] = useState(0)
  // Re-render every 30 s so "now", pace markers and statuses follow the real clock (including midnight).
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30_000); return () => clearInterval(id) }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); setQuick((q) => !q) } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  // A newly due reminder is shown once, when the companion is not busy with something else, then logged as delivered.
  const nextReminder = m.reminders[0]
  useEffect(() => {
    if (!nextReminder || (comp !== null && comp !== 'focus')) return
    setShownReminder(nextReminder)
    setComp('reminder')
    m.ackReminder(nextReminder.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextReminder?.key, comp])
  const live = prefs ? computeReminders(tasks, prefs.reminder, clock()) : []
  const reminder = (shownReminder && live.find((r) => r.key === shownReminder.key)) || live[0] || null
  const insights = useMemo(() => computeInsights(tasks, prefs?.insightsSince ?? null), [tasks, prefs?.insightsSince])

  const toggle = async (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    const saved = await m.task.toggle(t)
    if (saved?.completed) { setDone({ kind: 'completed', title: saved.title }); setComp('done') }
  }
  const toggleSub = (id: string, sid: string) => {
    const s = tasks.find((t) => t.id === id)?.subtasks.find((x) => x.id === sid)
    if (s) void m.task.updateSubtask(id, sid, { done: !s.done })
  }
  const added = (t: Task) => { setDone({ kind: 'added', title: t.title }); setComp('done') }
  const open = (id: string) => setDetail(id)
  const go = (p: Page) => { setPage(p); setDetail(null) }
  const openOverlay = (fn: () => void) => { m.dismissNotice(); fn() }
  const current = tasks.find((t) => t.id === detail)
  const editTask = tasks.find((t) => t.id === editing)
  const openCount = tasks.filter((t) => !t.completed).length
  const attention = tasks.filter((t) => ['At Risk', 'Overdue', 'Due Today'].includes(status(t))).length
  const name = prefs?.displayName ?? ''
  const overlayOpen = quick || adding || !!editing

  return (
    <div className="h-full flex min-w-[1200px]">
      <aside className="w-[228px] shrink-0 border-r border-line flex flex-col px-4 py-6">
        <div className="flex items-center gap-2.5 px-2 mb-9">
          <span className="flex flex-col gap-[3px]"><span className="w-4 h-px bg-ink" /><span className="w-2.5 h-px bg-ink" /><span className="w-3.5 h-px bg-ink" /></span>
          <span className="text-[13px] font-semibold tracking-[0.22em]">MIRA</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(([id, label, Icon]) => {
            const on = page === id
            return (
              <button key={id} onClick={() => go(id)} className={`relative flex items-center gap-3 h-8 px-2.5 rounded-[6px] text-[13.5px] transition-colors ${on ? 'bg-s1 text-ink font-medium' : 'text-ink2 hover:text-ink hover:bg-s1/60'}`}>
                {on && <span className="absolute -left-4 top-1.5 bottom-1.5 w-[2px] bg-ink" />}
                <span className={on ? 'text-ink' : 'text-mute'}><Icon /></span>{label}
                {id === 'tasks' && <span className="ml-auto text-[11px] text-mute">{openCount}</span>}
              </button>
            )
          })}
        </nav>
        <button onClick={() => openOverlay(() => setQuick(true))} className="mt-6 flex items-center justify-between h-8 px-2.5 rounded-[6px] border border-line text-[12.5px] text-ink2 hover:bg-s1">
          Quick add <span className="text-[10.5px] text-mute">Ctrl Space</span>
        </button>
        <div className="mt-auto">
          <div className="px-2.5 pb-4 mb-3 border-b border-line">
            <div className="label mb-1.5">This week</div>
            <div className="text-[12px] text-ink2 leading-relaxed">{attention} task{attention === 1 ? ' needs' : 's need'} attention</div>
          </div>
          <button onClick={() => go('settings')} className={`flex items-center gap-3 h-8 px-2.5 w-full rounded-[6px] text-[13.5px] ${page === 'settings' ? 'bg-s1 font-medium' : 'text-ink2 hover:bg-s1/60'}`}>
            <span className="text-mute"><ISettings /></span>Settings
          </button>
          <div className="flex items-center gap-2.5 px-2.5 mt-3">
            <span className="w-6 h-6 rounded-full bg-dark text-el text-[10px] grid place-items-center font-medium">{name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s*/, '').charAt(0) || 'M'}</span>
            <span className="text-[12.5px] text-ink2 truncate">{name}</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div key={`${page}-${detail}`} className="max-w-[1080px] px-14 pt-11 pb-20">
          {m.notice && !overlayOpen && <Notice className="mb-6" message={m.notice} onDismiss={m.dismissNotice} />}
          {m.phase === 'loading' && !prefs ? (
            <div className="py-8 text-[13px] text-mute">Loading your tasks…</div>
          ) : m.phase === 'error' || !prefs ? (
            <div className="rise py-8 max-w-[560px]">
              <div className="label mb-2">Offline</div>
              <div className="text-[14.5px] font-medium">{m.loadError ?? "Can't reach MIRA's local server."}</div>
              <div className="text-[12.5px] text-ink2 mt-1 leading-relaxed">MIRA keeps your tasks in a local database served by the MIRA server. Start it with <span className="font-medium text-ink">pnpm dev:all</span> and try again. Nothing has been changed.</div>
              <Btn className="mt-5" onClick={() => void m.reload()}>Try again</Btn>
            </div>
          ) : current ? (
            <Detail t={current} back={() => setDetail(null)} toggle={() => void toggle(current.id)} toggleSub={(sid) => toggleSub(current.id, sid)} actions={{
              onEdit: () => openOverlay(() => setEditing(current.id)),
              onDelete: async () => { if (await m.task.remove(current.id)) setDetail(null) },
              onStep: (by) => void m.task.stepCount(current.id, by),
              onAddSub: (title, key) => m.task.addSubtask(current.id, title, key),
              onRenameSub: (sid, title) => void m.task.updateSubtask(current.id, sid, { title }),
              onRemoveSub: (sid) => void m.task.removeSubtask(current.id, sid),
            }} />
          ) : page === 'today' ? <Today tasks={tasks} open={open} toggle={toggle} onAdd={() => openOverlay(() => setAdding(true))} />
            : page === 'tasks' ? <TaskList tasks={tasks} open={open} toggle={toggle} onAdd={() => openOverlay(() => setAdding(true))} />
            : page === 'completed' ? <TaskList completedOnly tasks={tasks} open={open} toggle={toggle} onAdd={() => openOverlay(() => setAdding(true))} />
            : page === 'timeline' ? <Timeline tasks={tasks} open={open} />
            : page === 'calendar' ? <Calendar tasks={tasks} open={open} mode={m.services.gcal ?? 'disconnected'} prefs={prefs} onError={m.report} />
            : <Settings prefs={prefs} setPrefs={m.updatePrefs} services={m.services} integrations={m.integrations} toggleService={(id) => void m.integration.toggle(id)}
                updateServiceSettings={(id, s) => void m.integration.updateSettings(id, s)} onAddFromMail={m.integration.importSuggestion}
                tasks={tasks} insights={insights.lines} onResetInsights={() => void m.resetInsights()} busy={m.busy} />}
        </div>
      </main>
      {quick && prefs && <QuickAdd prefs={prefs} error={m.notice} busy={m.busy.has('create')} onClose={() => setQuick(false)}
        onAdd={async (title, deadline, key) => { const t = await m.task.create({ title, startDate: today(), deadline }, key); if (t) { setQuick(false); added(t) } }} />}
      {prefs && m.phase === 'ready' && (
        <Companion prefs={prefs} tasks={tasks} state={comp} setState={setComp} reminder={reminder} done={done} error={comp === 'quick' && !overlayOpen ? m.notice : null}
          onOpen={() => go('today')}
          onQuickAdd={async (title) => { const t = await m.task.create({ title, deadline: addDays(today(), prefs.defaultDuration) }, newKey()); if (t) setDone({ kind: 'added', title: t.title }); return !!t }} />
      )}
      {adding && prefs && <AddTask defaultDuration={prefs.defaultDuration} assignmentDays={insights.assignmentDays} error={m.notice} busy={m.busy.has('create')} onClose={() => setAdding(false)}
        onCreate={async (input, key) => { const t = await m.task.create(input, key); if (t) { setAdding(false); setDetail(t.id) } }} />}
      {editTask && prefs && <AddTask task={editTask} defaultDuration={prefs.defaultDuration} assignmentDays={null} error={m.notice} busy={m.busy.has(`task:${editTask.id}`)} onClose={() => setEditing(null)}
        onSave={async (patch) => { if (await m.task.update(editTask.id, patch)) setEditing(null) }} />}
    </div>
  )
}
