import { useRef, useState } from 'react'
import { Task, clock, today, fmt, weekday, days, progress, status, duration, remaining, dueText, progressText, expected, completedOn, focusTask } from './data'
import { addDays, diffDays, isWeekend, longDate, rangeLabel, dayOfMonth } from '../../shared/dates'
import { daysBetween } from '../../shared/engine'
import { newKey } from './api'
import { Track, TaskRow, StatusText, Btn } from './ui'
import { Check, IBack, IClose, IMail, IPlus } from './icons'

type Nav = { open: (id: string) => void; toggle: (id: string) => void }

function Header({ eyebrow, title, right }: { eyebrow: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between pb-6 border-b border-ink/80">
      <div>
        <div className="label mb-2">{eyebrow}</div>
        <h1 className="text-[30px] leading-none font-medium tracking-[-0.02em]">{title}</h1>
      </div>
      {right}
    </div>
  )
}

/** The next unfinished step, in the words the Today screen uses. */
function nextStep(t: Task) {
  if (t.count) return { title: `${t.count.total - t.count.done} ${t.count.unit} left`, sub: `${t.count.done} of ${t.count.total} ${t.count.unit} done` }
  const next = t.subtasks.find((s) => !s.done)
  if (!t.subtasks.length) return { title: 'No steps yet', sub: 'Add steps from the task page' }
  return { title: next?.title ?? 'All steps done', sub: `${t.subtasks.filter((s) => s.done).length} of ${t.subtasks.length} steps done` }
}

/* ---------------- TODAY ---------------- */
export function Today({ tasks, open, toggle, onAdd }: Nav & { tasks: Task[]; onAdd: () => void }) {
  const now = today()
  const active = tasks.filter((t) => !t.completed && t.startDate <= now)
  const focus = focusTask(tasks)
  const doneToday = tasks.filter((t) => t.completed && completedOn(t) === now)
  const upcoming = tasks.filter((t) => !t.completed && t.startDate > now).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const order = (t: Task) => ['Overdue', 'Due Today', 'At Risk', 'Active'].indexOf(status(t))
  const behind = active.filter((t) => progress(t) < expected(t)).length
  const atRisk = active.filter((t) => status(t) === 'At Risk').length
  const left = focus ? remaining(focus) : 0
  const step = focus && nextStep(focus)

  return (
    <div className="rise">
      <Header eyebrow={`${weekday(now)} · ${longDate(now)}`} title="Today"
        right={<Btn primary onClick={onAdd}><IPlus /> New task</Btn>} />

      {focus && step && (
        <section onClick={() => open(focus.id)} className="grid grid-cols-[1fr_300px] gap-12 py-9 border-b border-line cursor-pointer group">
          <div>
            <div className="label mb-4">Current focus</div>
            <h2 className="text-[24px] font-medium tracking-[-0.015em] group-hover:underline decoration-line underline-offset-4">{focus.title}</h2>
            <div className="flex gap-10 mt-6">
              <Stat k={days(Math.abs(left))} v={left < 0 ? 'overdue' : 'remaining'} />
              <Stat k={`${Math.round(progress(focus) * 100)}%`} v="complete" />
              <Stat k={`${fmt(focus.startDate)} → ${fmt(focus.deadline)}`} v={`${duration(focus)}-day window`} />
            </div>
            <Track t={focus} thick className="mt-7 max-w-[560px]" />
            <div className="flex justify-between max-w-[560px] mt-2 text-[11px] text-mute">
              <span>Started {fmt(focus.startDate)}</span>
              <span className="text-ink2">Pace marker — {Math.round(expected(focus) * 100)}% expected by now</span>
              <span>Deadline {fmt(focus.deadline)}</span>
            </div>
          </div>
          <div className="border-l border-line pl-8">
            <div className="label mb-4">Next step</div>
            <div className="text-[14.5px] font-medium">{step.title}</div>
            <div className="text-[12px] text-ink2 mt-1">{step.sub}</div>
            <div className="mt-7 pt-5 border-t border-line text-[12.5px] text-ink2 leading-relaxed">
              {behind === 0 ? 'Everything is on pace.' : `${behind} of ${active.length} active tasks ${behind === 1 ? 'is' : 'are'} behind pace${atRisk ? `, ${atRisk} at risk.` : '.'}`}
            </div>
          </div>
        </section>
      )}

      <Section label="Active" count={active.length}>
        {[...active].sort((a, b) => order(a) - order(b)).map((t) => <TaskRow key={t.id} t={t} onOpen={() => open(t.id)} onToggle={() => toggle(t.id)} />)}
        {!active.length && <div className="py-3 text-[13px] text-mute">Nothing in progress.</div>}
      </Section>
      <div className="grid grid-cols-2 gap-12">
        <Section label="Starting soon" count={upcoming.length}>
          {upcoming.map((t) => (
            <div key={t.id} onClick={() => open(t.id)} className="py-3 border-b border-line cursor-pointer hover:text-ink2 flex justify-between text-[13.5px]">
              <span className="font-medium">{t.title}</span><span className="text-[12px] text-mute">{dueText(t)}</span>
            </div>
          ))}
        </Section>
        <Section label="Completed" count={doneToday.length}>
          {doneToday.map((t) => <TaskRow key={t.id} t={t} onOpen={() => open(t.id)} onToggle={() => toggle(t.id)} />)}
          {!doneToday.length && <div className="py-3 text-[13px] text-mute">Nothing finished yet today.</div>}
        </Section>
      </div>
    </div>
  )
}
const Stat = ({ k, v }: { k: string; v: string }) => (
  <div><div className="text-[17px] font-medium tracking-[-0.01em]">{k}</div><div className="text-[11.5px] text-mute mt-0.5">{v}</div></div>
)
function Section({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="pt-8">
      <div className="flex items-baseline gap-2 pb-2 border-b border-line"><span className="label !text-ink2">{label}</span>{count !== undefined && <span className="label">{count}</span>}</div>
      {children}
    </section>
  )
}

/* ---------------- ALL TASKS / COMPLETED ---------------- */
export function TaskList({ tasks, open, toggle, onAdd, completedOnly }: Nav & { tasks: Task[]; onAdd: () => void; completedOnly?: boolean }) {
  const [filter, setFilter] = useState('All')
  const filters = ['All', 'Active', 'At Risk', 'Due Today', 'Upcoming', 'Overdue']
  const list = completedOnly
    ? tasks.filter((t) => t.completed).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    : tasks.filter((t) => !t.completed && (filter === 'All' || status(t) === filter))
  return (
    <div className="rise">
      <Header eyebrow={completedOnly ? 'Archive' : `${tasks.filter((t) => !t.completed).length} open`} title={completedOnly ? 'Completed' : 'Tasks'}
        right={!completedOnly && <Btn primary onClick={onAdd}><IPlus /> New task</Btn>} />
      {!completedOnly && (
        <div className="flex gap-5 pt-5">
          {filters.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`text-[12.5px] pb-1 border-b transition-colors ${filter === f ? 'border-ink text-ink font-medium' : 'border-transparent text-mute hover:text-ink2'}`}>{f}</button>
          ))}
        </div>
      )}
      <div className="pt-4">
        {list.map((t) => <TaskRow key={t.id} t={t} onOpen={() => open(t.id)} onToggle={() => toggle(t.id)} />)}
        {!list.length && <div className="py-8 text-[13px] text-mute">No tasks here.</div>}
      </div>
    </div>
  )
}

/* ---------------- TASK DETAIL ---------------- */
export type DetailActions = {
  onEdit: () => void
  onDelete: () => void
  onStep: (by: number) => void
  onAddSub: (title: string, key: string) => Promise<unknown>
  onRenameSub: (sid: string, title: string) => void
  onRemoveSub: (sid: string) => void
}

export function Detail({ t, back, toggle, toggleSub, actions }: { t: Task; back: () => void; toggle: () => void; toggleSub: (sid: string) => void; actions: DetailActions }) {
  const now = today()
  const days_ = daysBetween(t.startDate, t.deadline)
  const every = Math.ceil(days_.length / 15)
  const nowPos = expected(t)
  const left = remaining(t)
  const [draft, setDraft] = useState('')
  const draftKey = useRef(newKey())
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const addSub = async () => {
    const title = draft.trim()
    if (!title) return
    if (await actions.onAddSub(title, draftKey.current)) { setDraft(''); draftKey.current = newKey() }
  }
  const saveRename = () => {
    if (renaming && renaming.title.trim()) actions.onRenameSub(renaming.id, renaming.title.trim())
    setRenaming(null)
  }
  return (
    <div className="rise">
      <button onClick={back} className="flex items-center gap-1 text-[12.5px] text-ink2 hover:text-ink mb-6 -ml-1"><IBack /> Back</button>
      <div className="flex items-start justify-between pb-6 border-b border-ink/80">
        <div>
          <StatusText t={t} />
          <h1 className="text-[30px] leading-tight font-medium tracking-[-0.02em] mt-2">{t.title}</h1>
          <p className="text-[13.5px] text-ink2 mt-2 max-w-[600px] leading-relaxed">{t.description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Btn onClick={actions.onEdit}>Edit</Btn>
          <Btn primary={!t.completed} onClick={toggle}>{t.completed ? 'Reopen' : 'Mark complete'}</Btn>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-line">
        {[
          [`${fmt(t.startDate)} → ${fmt(t.deadline)}`, 'Window'],
          [days(duration(t)), 'Duration'],
          [`${Math.round(progress(t) * 100)}%`, 'Complete'],
          [t.completed ? '—' : left < 0 ? `${days(-left)} over` : days(left), 'Remaining'],
        ].map(([k, v], i) => (
          <div key={v} className={`py-5 ${i ? 'pl-6 border-l border-line' : ''}`}>
            <div className="label mb-1.5">{v}</div><div className="text-[18px] font-medium tracking-[-0.01em]">{k}</div>
          </div>
        ))}
      </div>

      {/* Lifecycle timeline — the task occupying its duration */}
      <section className="py-9 border-b border-line">
        <div className="label mb-6">Lifecycle</div>
        <div className="relative">
          <div className="flex justify-between text-[11.5px] text-ink2 mb-3">
            {days_.map((d, i) => <span key={d} className={`w-0 whitespace-nowrap flex justify-center ${d === now ? 'text-ink font-medium' : ''}`}><span>{i % every === 0 || d === now ? `${weekday(d)} ${dayOfMonth(d)}` : ''}</span></span>)}
          </div>
          <div className="relative h-8 mx-0">
            <div className="absolute top-1/2 inset-x-0 h-px bg-line" />
            {days_.map((d, i) => <div key={d} className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-mute" style={{ left: `${(i / Math.max(1, days_.length - 1)) * 100}%` }} />)}
            <div className="absolute top-1/2 -translate-y-1/2 h-[6px] bg-s2 inset-x-0" />
            <div className="absolute top-1/2 -translate-y-1/2 h-[6px] bg-dark transition-[width] duration-500" style={{ width: `${progress(t) * 100}%` }} />
            {!t.completed && nowPos > 0 && nowPos < 1 && (
              <div className="absolute -top-1 bottom-[-4px] w-px bg-ink" style={{ left: `${nowPos * 100}%` }}>
                <span className="absolute top-full mt-1.5 -translate-x-1/2 label !text-ink whitespace-nowrap">Now</span>
              </div>
            )}
          </div>
          <div className="flex justify-between mt-6 text-[11px] text-mute"><span>Start</span><span>Deadline</span></div>
        </div>
      </section>

      <div className="grid grid-cols-[1fr_260px] gap-12 pt-8">
        <section>
          <div className="flex items-baseline justify-between pb-2 border-b border-line">
            <span className="label !text-ink2">Checklist</span><span className="label">{progressText(t)}</span>
          </div>
          {t.count && (
            <div className="flex items-center justify-between py-4 text-[13.5px] text-ink2">
              <span>Tracked by count — {t.count.done} of {t.count.total} {t.count.unit}.</span>
              <span className="flex items-center gap-2">
                <button aria-label="Count one fewer" disabled={t.count.done <= 0} onClick={() => actions.onStep(-1)} className="w-5 h-5 border border-line rounded-[4px] text-ink2 hover:bg-s1 leading-none disabled:opacity-40 disabled:hover:bg-transparent">−</button>
                <button aria-label="Count one more" disabled={t.count.done >= t.count.total} onClick={() => actions.onStep(1)} className="w-5 h-5 border border-line rounded-[4px] text-ink2 hover:bg-s1 leading-none disabled:opacity-40 disabled:hover:bg-transparent">+</button>
              </span>
            </div>
          )}
          {t.subtasks.map((s) => (
            <div key={s.id} className="group flex items-center gap-3 py-3 border-b border-line">
              <Check done={s.done} onClick={() => toggleSub(s.id)} size={15} />
              {renaming?.id === s.id ? (
                <input autoFocus value={renaming.title} onChange={(e) => setRenaming({ id: s.id, title: e.target.value })} onBlur={saveRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null) }}
                  className="flex-1 bg-transparent outline-none text-[14px]" />
              ) : (
                <span onDoubleClick={() => setRenaming({ id: s.id, title: s.title })} className={`flex-1 text-[14px] transition-colors ${s.done ? 'text-mute line-through decoration-line' : ''}`}>{s.title}</span>
              )}
              <button aria-label={`Remove ${s.title}`} onClick={() => actions.onRemoveSub(s.id)} className="text-mute hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"><IClose /></button>
            </div>
          ))}
          {!t.count && (
            <div className="flex items-center gap-3 py-3 border-b border-line text-[14px] text-mute">
              <IPlus />
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder="Add a step, press Enter"
                className="flex-1 bg-transparent outline-none text-ink placeholder:text-mute" />
            </div>
          )}
        </section>
        <aside className="text-[13px]">
          <div className="label !text-ink2 pb-2 border-b border-line">Details</div>
          {[['Priority', t.priority], ['Reminder', t.reminder], ['Status', status(t) === 'Active' ? 'In progress' : status(t)], ['Due', dueText(t)]].map(([k, v]) => (
            <div key={k} className="flex justify-between py-2.5 border-b border-line"><span className="text-mute">{k}</span><span>{v}</span></div>
          ))}
          {t.source && (
            <div className="flex items-center gap-2 mt-4 text-[12px] text-ink2"><IMail /> {t.sourceRef?.startsWith('demo:') ? `Created from a ${t.source} demo message` : `Created from a ${t.source} message`}</div>
          )}
          {confirmDelete ? (
            <div className="flex gap-3 mt-3 text-[11.5px]">
              <button onClick={actions.onDelete} className="text-ink font-medium hover:underline">Delete permanently</button>
              <button onClick={() => setConfirmDelete(false)} className="text-mute hover:text-ink2">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-[11.5px] text-mute hover:text-ink2 mt-3">Delete task</button>
          )}
        </aside>
      </div>
    </div>
  )
}

/* ---------------- TIMELINE ---------------- */
export function Timeline({ tasks, open }: { tasks: Task[]; open: (id: string) => void }) {
  const now = today()
  const n = 14
  const first = addDays(now, -4)
  const last = addDays(first, n - 1)
  const days_ = daysBetween(first, last)
  const list = tasks.filter((t) => t.startDate <= last && t.deadline >= first).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const pct = (d: string, frac = 0) => Math.min(100, Math.max(0, ((diffDays(first, d) + frac) / n) * 100))
  const load = days_.map((d) => tasks.filter((t) => !t.completed && t.startDate <= d && t.deadline >= d).length)
  const maxLoad = Math.max(1, ...load)
  const nowFrac = clock().dayFraction
  return (
    <div className="rise">
      <Header eyebrow={rangeLabel(first, last)} title="Timeline"
        right={<div className="flex items-center gap-5 text-[11.5px] text-ink2">
          <span className="flex items-center gap-2"><span className="w-5 h-[5px] bg-dark" />Progress</span>
          <span className="flex items-center gap-2"><span className="w-5 h-[5px] bg-s2 border border-line" />Remaining</span>
          <span className="flex items-center gap-2"><span className="w-px h-3 bg-ink" />Now</span>
        </div>} />

      <div className="grid grid-cols-[220px_1fr] mt-2">
        <div />
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {days_.map((d) => (
            <div key={d} className={`py-3 text-center ${d === now ? 'text-ink' : 'text-mute'}`}>
              <div className="text-[10px] tracking-[0.08em] uppercase">{weekday(d)}</div>
              <div className={`text-[13px] mt-0.5 ${d === now ? 'font-semibold' : ''}`}>{dayOfMonth(d)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        <div className="absolute inset-y-0 left-[220px] right-0 grid pointer-events-none" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {days_.map((d) => <div key={d} className={`border-l ${isWeekend(d) ? 'bg-s1/50 border-line/60' : 'border-line/60'}`} />)}
          <div className="absolute inset-y-0 w-px bg-ink z-10" style={{ left: `${pct(now, nowFrac)}%` }} />
        </div>
        {list.map((t) => {
          const p = progress(t)
          const st = status(t)
          const endsInside = t.deadline <= last
          return (
            <div key={t.id} onClick={() => open(t.id)} className="relative grid grid-cols-[220px_1fr] items-center h-[62px] border-b border-line cursor-pointer group">
              <div className="pr-4 min-w-0">
                <div className={`text-[13.5px] font-medium truncate group-hover:underline decoration-line underline-offset-2 ${t.completed ? 'text-mute' : ''}`}>{t.title}</div>
                <div className="text-[11.5px] text-mute mt-0.5">{dueText(t)}</div>
              </div>
              <div className="relative h-full">
                <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${pct(t.startDate)}%`, width: `${pct(t.deadline, 1) - pct(t.startDate)}%` }}>
                  <div className={`relative h-[7px] ${t.completed ? 'bg-line' : st === 'Upcoming' ? 'bg-s2 border border-dashed border-mute/60' : 'bg-s2'}`}>
                    {!t.completed && <div className={`absolute inset-y-0 left-0 ${st === 'At Risk' || st === 'Overdue' ? 'bg-graphite' : 'bg-dark'}`} style={{ width: `${p * 100}%` }} />}
                    {endsInside && <div className="absolute -right-px -top-[5px] w-[2px] h-[17px] bg-ink" />}
                  </div>
                  <div className="flex justify-between text-[10.5px] text-mute mt-1.5 whitespace-nowrap">
                    <span>{fmt(t.startDate)}</span><span className={st === 'Due Today' || st === 'Overdue' ? 'text-ink font-medium' : ''}>{fmt(t.deadline)}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {!list.length && <div className="py-8 text-[13px] text-mute">No tasks in these two weeks.</div>}
      </div>

      <div className="grid grid-cols-[220px_1fr] pt-5">
        <div><div className="label">Workload</div><div className="text-[11.5px] text-mute mt-1">Overlapping open tasks</div></div>
        <div className="grid items-end h-12" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {load.map((l, i) => (
            <div key={i} className="flex flex-col items-center justify-end gap-1 h-full">
              <div className={`w-[60%] ${l === maxLoad ? 'bg-dark' : 'bg-s2'}`} style={{ height: `${(l / maxLoad) * 28}px` }} />
              <span className="text-[10px] text-mute">{l || ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
