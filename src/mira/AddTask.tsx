import { useRef, useState } from 'react'
import { Task, Priority, today, weekday, duration } from './data'
import { addDays, dayOfMonth, diffDays, monthLong } from '../../shared/dates'
import { looksLikeAssignment } from '../../shared/insights'
import { TASK_REMINDERS, type CreateTaskInput, type TaskReminder, type UpdateTaskInput } from '../../shared/types'
import { newKey } from './api'
import { Btn } from './ui'
import { IClose, IPlus } from './icons'

type Props = {
  onClose: () => void
  defaultDuration: number
  /** Typical assignment window computed from the user's history, if there is enough of it. */
  assignmentDays: number | null
  error: string | null
  busy: boolean
  onCreate?: (input: CreateTaskInput, key: string) => void
  /** Edit mode */
  task?: Task
  onSave?: (patch: UpdateTaskInput) => void
}

export default function AddTask({ onClose, onCreate, onSave, task, defaultDuration, assignmentDays, error, busy }: Props) {
  const now = today()
  const editing = !!task
  const initialDur = task ? duration(task) : defaultDuration
  const [title, setTitle] = useState(task?.title ?? '')
  const [desc, setDesc] = useState(task?.description ?? '')
  const [start, setStart] = useState(task?.startDate ?? now)
  const [dur, setDur] = useState(initialDur)
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'Medium')
  const [reminder, setReminder] = useState<TaskReminder>(task?.reminder ?? 'Smart')
  const [subs, setSubs] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState(true)
  const key = useRef(newKey())
  const end = addDays(start, dur)
  const minDur = Math.min(1, initialDur)
  const maxDur = Math.max(9, initialDur)
  const suggested = !editing && looksLikeAssignment(title) ? assignmentDays : null

  const create = () => {
    if (!title.trim() || busy) return
    if (task) onSave?.({ title: title.trim(), description: desc, startDate: start, deadline: end, priority, reminder })
    else onCreate?.({ title: title.trim(), description: desc, startDate: start, deadline: end, priority, subtasks: subs }, key.current)
  }
  const addSub = () => { if (draft.trim()) { setSubs([...subs, draft.trim()]); setDraft('') } }
  const days = Array.from({ length: 10 }, (_, i) => addDays(now, i - 1))
  const options = days.includes(start) ? days : [start, ...days].sort()
  const fmtLong = (d: string) => `${weekday(d)}, ${dayOfMonth(d)} ${monthLong(d)}`
  const offset = diffDays(days[0], start)
  const left = Math.min(100, Math.max(0, (offset / 10) * 100))
  const right = Math.min(100, Math.max(0, ((offset + dur + 1) / 10) * 100))

  return (
    <div className="fixed inset-0 z-50 bg-dark/25 grid place-items-center fade" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="rise w-[620px] bg-el border border-line rounded-[10px] shadow-[0_20px_50px_-20px_rgba(28,28,28,0.35)]">
        <div className="flex items-center justify-between px-7 pt-5">
          <span className="label">{editing ? 'Edit task' : 'New task'}</span>
          <button onClick={onClose} className="text-mute hover:text-ink"><IClose /></button>
        </div>
        <div className="px-7 pt-3 pb-6">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" maxLength={200}
            className="w-full bg-transparent text-[22px] font-medium tracking-[-0.015em] outline-none placeholder:text-mute" />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" rows={2} maxLength={5000}
            className="w-full bg-transparent text-[13.5px] text-ink2 outline-none resize-none mt-2 placeholder:text-mute" />

          <div className="grid grid-cols-3 border-y border-line mt-4">
            <Field label="Start">
              <select value={start} onChange={(e) => setStart(e.target.value)} className="bg-transparent outline-none text-[14px] font-medium -ml-1">
                {options.map((d) => <option key={d} value={d}>{fmtLong(d)}</option>)}
              </select>
            </Field>
            <Field label="Deadline" border>
              <div className="text-[14px] font-medium">{fmtLong(end)}</div>
            </Field>
            <Field label="Duration" border>
              <div className="flex items-center gap-2">
                <button onClick={() => setDur(Math.max(minDur, dur - 1))} className="w-5 h-5 border border-line rounded-[4px] text-ink2 hover:bg-s1 leading-none">−</button>
                <span className="text-[14px] font-medium w-14 text-center">{dur} day{dur === 1 ? '' : 's'}</span>
                <button onClick={() => setDur(Math.min(maxDur, dur + 1))} className="w-5 h-5 border border-line rounded-[4px] text-ink2 hover:bg-s1 leading-none">+</button>
              </div>
            </Field>
          </div>

          {/* Preview: the task occupying its window */}
          <div className="pt-5">
            <div className="grid grid-cols-10 text-[10px] text-mute text-center mb-1.5">
              {days.map((d) => <span key={d} className={d === now ? 'text-ink font-medium' : ''}>{dayOfMonth(d)}</span>)}
            </div>
            <div className="relative h-[6px] bg-s1">
              <div className="absolute inset-y-0 bg-dark transition-all duration-300" style={{ left: `${left}%`, width: `${right - left}%` }} />
            </div>
            <p className="text-[12px] text-ink2 mt-3">MIRA will track this task across its {dur + 1} available days and mark the pace you need to keep.</p>
          </div>

          {hint && suggested && dur !== suggested && (
            <div className="fade mt-4 flex items-center justify-between border-l-2 border-ink pl-3 py-1">
              <span className="text-[12.5px] text-ink2">You usually allow {suggested} day{suggested === 1 ? '' : 's'} for assignments.</span>
              <span className="flex gap-3 text-[12.5px]">
                <button onClick={() => setDur(Math.min(maxDur, suggested))} className="font-medium hover:underline">Use {suggested} day{suggested === 1 ? '' : 's'}</button>
                <button onClick={() => setHint(false)} className="text-mute hover:text-ink2">Dismiss</button>
              </span>
            </div>
          )}

          <div className="grid grid-cols-[180px_1fr] gap-8 mt-6">
            <div>
              <div className="label mb-2">Priority</div>
              <div className="flex border border-line rounded-[7px] p-0.5">
                {(['Low', 'Medium', 'High'] as Priority[]).map((p) => (
                  <button key={p} onClick={() => setPriority(p)} className={`flex-1 h-7 text-[12px] rounded-[5px] transition-colors ${priority === p ? 'bg-dark text-el' : 'text-ink2 hover:bg-s1'}`}>{p}</button>
                ))}
              </div>
            </div>
            {editing ? (
              <div>
                <div className="label mb-2">Reminder</div>
                <div className="flex border border-line rounded-[7px] p-0.5">
                  {TASK_REMINDERS.map((r) => (
                    <button key={r} onClick={() => setReminder(r)} className={`flex-1 h-7 text-[12px] rounded-[5px] transition-colors ${reminder === r ? 'bg-dark text-el' : 'text-ink2 hover:bg-s1'}`}>{r}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className="label mb-2">Subtasks</div>
                {subs.map((s, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-1.5 border-b border-line text-[13px]">
                    <span className="w-3 h-3 rounded-full border border-mute" />{s}
                  </div>
                ))}
                <div className="flex items-center gap-2.5 py-1.5 text-[13px] text-mute">
                  <IPlus />
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder="Add a step, press Enter"
                    className="flex-1 bg-transparent outline-none text-ink placeholder:text-mute" />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between px-7 py-4 border-t border-line bg-bg/60 rounded-b-[10px]">
          {error ? <span role="alert" className="text-[11.5px] text-ink pr-4">{error}</span> : <span className="text-[11.5px] text-mute">Esc to close</span>}
          <div className="flex gap-2 shrink-0"><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={busy} onClick={create}>{busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes →' : 'Create task →'}</Btn></div>
        </div>
      </div>
    </div>
  )
}
const Field = ({ label, children, border }: { label: string; children: React.ReactNode; border?: boolean }) => (
  <div className={`py-3.5 ${border ? 'pl-5 border-l border-line' : ''}`}><div className="label mb-1.5">{label}</div>{children}</div>
)
