import { useEffect, useRef, useState } from 'react'
import { Task, clock, today, fmt, weekday, days, progress, remaining, focusTask, completedOn } from './data'
import { addDays, dayOfMonth, diffDays, isWeekend, rangeLabel } from '../../shared/dates'
import { daysBetween } from '../../shared/engine'
import { planWorkBlocks } from '../../shared/planner'
import { parseQuickAdd } from '../../shared/quickAdd'
import { WORKING_HOURS, WORKING_HOUR_RANGES, REMINDER_PREFERENCES, type CalendarEvent, type ConnectionMode, type IntegrationStatus, type MailSuggestion, type Preferences, type ProviderId, type Reminder } from '../../shared/types'
import { api, newKey } from './api'
import { errorMessage, type Services } from './store'
import { Btn } from './ui'
import { IClose, IMail, ICal } from './icons'

export type Prefs = Preferences
export type { Services }
/** What the companion's completion card confirms. */
export type Done = { kind: 'completed' | 'added'; title: string }

function Header({ eyebrow, title, right }: { eyebrow: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between pb-6 border-b border-ink/80">
      <div><div className="label mb-2">{eyebrow}</div><h1 className="text-[30px] leading-none font-medium tracking-[-0.02em]">{title}</h1></div>
      {right}
    </div>
  )
}

const isOn = (mode: ConnectionMode | undefined) => !!mode && mode !== 'disconnected'

/* ---------------- CALENDAR ---------------- */
export function Calendar({ tasks, open, mode, prefs, onError }: { tasks: Task[]; open: (id: string) => void; mode: ConnectionMode; prefs: Prefs; onError: (message: string) => void }) {
  const now = today()
  const c = clock()
  const days_ = daysBetween(now, addDays(now, 6))
  const H0 = 8, H1 = 23, PX = 34
  const [w0, w1] = WORKING_HOUR_RANGES[prefs.workingHours]
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [sync, setSync] = useState<'idle' | 'syncing'>('idle')
  useEffect(() => {
    let live = true
    if (mode === 'disconnected') { setEvents([]); return }
    api.integrations.events(days_[0], days_[6]).then((e) => live && setEvents(e)).catch((e) => live && onError(errorMessage(e)))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, days_[0]])
  const doSync = async () => {
    setSync('syncing')
    try { await api.integrations.syncCalendar() } catch (e) { onError(errorMessage(e)) } finally { setSync('idle') }
  }
  const spans = tasks.filter((t) => !t.completed && t.deadline >= days_[0] && t.startDate <= days_[6])
  const col = (d: string) => Math.max(0, diffDays(days_[0], d))
  const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? ''
  const blocks = planWorkBlocks(tasks, [w0, w1], days_, c)

  return (
    <div className="rise">
      <Header eyebrow={rangeLabel(days_[0], days_[6])} title="Calendar" right={
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-[12px] text-ink2"><ICal />Google Calendar · {mode === 'connected' ? 'Connected' : mode === 'demo' ? <>Demo data <span className="text-mute">· not synced</span></> : 'Not connected'}</span>
          <Btn onClick={doSync} disabled={sync === 'syncing'}>
            <span className={`w-3 h-3 border border-ink2 rounded-full ${sync === 'syncing' ? 'border-t-transparent animate-spin' : ''}`} />
            {sync === 'syncing' ? 'Syncing' : 'Sync with Google Calendar'}
          </Btn>
        </div>} />

      <div className="grid grid-cols-[52px_1fr] mt-1">
        <div />
        <div className="grid grid-cols-7 border-b border-line">
          {days_.map((d) => (
            <div key={d} className={`py-3 pl-2 ${d === now ? 'text-ink' : 'text-mute'}`}>
              <span className="text-[10px] tracking-[0.08em] uppercase mr-1.5">{weekday(d)}</span>
              <span className={`text-[13px] ${d === now ? 'font-semibold' : ''}`}>{dayOfMonth(d)}</span>
            </div>
          ))}
        </div>
        {/* Multi-day task spans: one coherent object per task, not duplicate events */}
        <div className="label pt-2.5">Tasks</div>
        <div className="relative border-b border-line py-2" style={{ height: spans.length * 26 + 16 }}>
          {spans.map((t, i) => {
            const a = col(t.startDate), b = Math.min(6, diffDays(days_[0], t.deadline))
            const endsThisWeek = t.deadline <= days_[6]
            return (
              <button key={t.id} onClick={() => open(t.id)} className="absolute h-[20px] flex items-center group" style={{ top: 8 + i * 26, left: `calc(${(a / 7) * 100}% + 4px)`, width: `calc(${((b - a + 1) / 7) * 100}% - 8px)` }}>
                <span className={`absolute inset-0 rounded-[4px] ${t.startDate > now ? 'bg-s1 border border-dashed border-mute/60' : 'bg-s2'} group-hover:bg-line transition-colors`} />
                <span className="absolute left-0 inset-y-0 bg-dark/85 rounded-l-[4px]" style={{ width: t.startDate < days_[0] ? 0 : 2 }} />
                <span className="relative px-2.5 text-[11.5px] font-medium truncate">{t.title}</span>
                <span className="relative ml-auto pr-2 text-[10.5px] text-ink2 whitespace-nowrap">{endsThisWeek ? `Due ${fmt(t.deadline)}` : '→'}</span>
                {endsThisWeek && <span className="absolute right-0 -top-1 -bottom-1 w-[2px] bg-ink" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="relative grid grid-cols-[52px_1fr] mt-0 overflow-hidden" style={{ height: (H1 - H0) * PX }}>
        <div className="relative">
          {Array.from({ length: H1 - H0 }, (_, i) => (
            <div key={i} className="absolute text-[10px] text-mute -translate-y-1/2" style={{ top: i * PX }}>{i ? `${(H0 + i) % 12 || 12} ${H0 + i < 12 ? 'AM' : 'PM'}` : ''}</div>
          ))}
        </div>
        <div className="relative grid grid-cols-7">
          {days_.map((d) => <div key={d} className={`border-l border-line/70 ${isWeekend(d) ? 'bg-s1/40' : ''}`} />)}
          {Array.from({ length: H1 - H0 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-line/50" style={{ top: i * PX }} />)}
          {/* Working hours band */}
          <div className="absolute inset-x-0 border-y border-dashed border-line" style={{ top: (w0 - H0) * PX, height: (w1 - w0) * PX }} />
          <span className="absolute right-2 label" style={{ top: (w0 - H0) * PX + 4 }}>Working hours</span>
          {events.map((e) => (
            <div key={e.id} className="absolute px-2 py-1 border-l-2 border-mute bg-s1 text-[11px] text-ink2 rounded-r-[4px]" style={{ top: (e.from - H0) * PX + 1, height: (e.to - e.from) * PX - 2, left: `calc(${(col(e.date) / 7) * 100}% + 3px)`, width: `calc(${100 / 7}% - 6px)` }}>
              {e.title}<div className="text-[10px] text-mute">{e.source === 'demo' ? 'Demo event' : 'Google Calendar'}</div>
            </div>
          ))}
          {blocks.map((b) => (
            <button key={`${b.date}-${b.taskId}`} onClick={() => open(b.taskId)} className="absolute px-2 py-1 text-left bg-dark text-el rounded-[4px] hover:bg-dark2 transition-colors" style={{ top: (b.from - H0) * PX + 1, height: (b.to - b.from) * PX - 2, left: `calc(${(col(b.date) / 7) * 100}% + 3px)`, width: `calc(${100 / 7}% - 6px)` }}>
              <div className="text-[11px] font-medium truncate">{title(b.taskId)}</div>
              <div className="text-[10px] text-el/60 truncate">{b.label}</div>
            </button>
          ))}
          {c.hour >= H0 && c.hour <= H1 && (
            <div className="absolute inset-x-0 z-10 h-px bg-ink" style={{ top: (c.hour - H0) * PX, left: 0, width: `${100 / 7}%` }}>
              <span className="absolute -left-1 -top-[3px] w-[7px] h-[7px] rounded-full bg-ink" />
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-6 pt-5 mt-1 border-t border-line text-[11.5px] text-ink2">
        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-dark rounded-[2px]" />MIRA work block</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-s1 border-l-2 border-mute" />Calendar event</span>
        <span className="text-mute">{mode === 'connected' ? 'Work blocks are placed inside your working hours and written back to Google Calendar on sync.' : 'Work blocks are proposed inside your working hours. Writing them to Google Calendar needs a connected account.'}</span>
      </div>
    </div>
  )
}

/* ---------------- SETTINGS ---------------- */
const SERVICES: { id: ProviderId; name: string; note: string; glyph: string }[] = [
  { id: 'gcal', name: 'Google Calendar', note: 'Work blocks and deadlines', glyph: 'C' },
  { id: 'gmail', name: 'Gmail', note: 'Detects deadlines and requests', glyph: 'M' },
  { id: 'notion', name: 'Notion', note: 'Import pages as tasks', glyph: 'N' },
  { id: 'slack', name: 'Slack', note: 'Turn messages into tasks', glyph: 'S' },
  { id: 'github', name: 'GitHub', note: 'Track issues and reviews', glyph: 'G' },
  { id: 'drive', name: 'Google Drive', note: 'Attach documents', glyph: 'D' },
  { id: 'outlook', name: 'Microsoft Outlook', note: 'Mail and calendar', glyph: 'O' },
]

export function Settings({ prefs, setPrefs, services, integrations, toggleService, updateServiceSettings, onAddFromMail, tasks, insights, onResetInsights, busy }: {
  prefs: Prefs; setPrefs: (p: Prefs) => void; services: Services; integrations: IntegrationStatus[]
  toggleService: (id: ProviderId) => void; updateServiceSettings: (id: ProviderId, settings: Record<string, boolean>) => void
  onAddFromMail: (messageId: string) => Promise<Task | undefined>; tasks: Task[]; insights: string[]; onResetInsights: () => void; busy: ReadonlySet<string>
}) {
  const [tab, setTab] = useState('About you')
  const tabs = ['About you', 'Connected services', 'Gmail', 'Google Calendar']
  const gcal = integrations.find((i) => i.id === 'gcal')
  return (
    <div className="rise">
      <Header eyebrow="Preferences" title="Settings" />
      <div className="flex gap-6 pt-5 border-b border-line">
        {tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`text-[13px] pb-3 -mb-px border-b transition-colors ${tab === t ? 'border-ink text-ink font-medium' : 'border-transparent text-mute hover:text-ink2'}`}>{t}</button>)}
      </div>
      <div key={tab} className="fade">
        {tab === 'About you' && <About prefs={prefs} setPrefs={setPrefs} services={services} tasks={tasks} insights={insights} onResetInsights={onResetInsights} goServices={() => setTab('Connected services')} />}
        {tab === 'Connected services' && <ServiceList services={services} toggle={toggleService} busy={busy} />}
        {tab === 'Gmail' && <Gmail mode={services.gmail ?? 'disconnected'} onAdd={onAddFromMail} busy={busy} />}
        {tab === 'Google Calendar' && <GCal mode={services.gcal ?? 'disconnected'} account={gcal?.account ?? null} toggle={() => toggleService('gcal')}
          opts={{ blocks: true, deadlines: true, busy: true, ...gcal?.settings }} setOpt={(k, v) => updateServiceSettings('gcal', { [k]: v })} />}
      </div>
    </div>
  )
}

function Row({ k, hint, children }: { k: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[260px_1fr] items-center py-4 border-b border-line">
      <div><div className="text-[13.5px] font-medium">{k}</div>{hint && <div className="text-[11.5px] text-mute mt-0.5">{hint}</div>}</div>
      <div>{children}</div>
    </div>
  )
}
const inputCls = 'h-8 px-2.5 w-[320px] bg-el border border-line rounded-[6px] text-[13.5px] outline-none focus:border-ink2 transition-colors'
function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex border border-line rounded-[7px] p-0.5 bg-el">
      {options.map((o) => <button key={o} onClick={() => onChange(o)} className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors ${value === o ? 'bg-dark text-el' : 'text-ink2 hover:bg-s1'}`}>{o}</button>)}
    </div>
  )
}

function About({ prefs, setPrefs, services, tasks, insights, onResetInsights, goServices }: {
  prefs: Prefs; setPrefs: (p: Prefs) => void; services: Services; tasks: Task[]; insights: string[]; onResetInsights: () => void; goServices: () => void
}) {
  const greetings = [`Welcome, ${prefs.displayName}.`, `Welcome back, ${prefs.displayName}.`, `Good evening, ${prefs.displayName}.`]
  const connected = SERVICES.filter((s) => services[s.id] === 'connected')
  const demo = SERVICES.filter((s) => services[s.id] === 'demo')
  const summary = [connected.length && `${connected.length} connected`, demo.length && `${demo.length} in demo mode`].filter(Boolean).join(', ') || 'None connected'
  const names = [...connected, ...demo].map((s) => s.name).join(', ')
  return (
    <div className="grid grid-cols-[1fr_280px] gap-14">
      <div>
        <div className="label pt-7 pb-2">About you</div>
        <Row k="Name" hint="How MIRA addresses you"><input className={inputCls} value={prefs.displayName} maxLength={80} onChange={(e) => setPrefs({ ...prefs, displayName: e.target.value })} /></Row>
        <Row k="Preferred greeting">
          <select className={inputCls} value={greetings.findIndex((g) => g.split(',')[0] === prefs.greeting)} onChange={(e) => setPrefs({ ...prefs, greeting: greetings[+e.target.value].split(',')[0] as Prefs['greeting'] })}>
            {greetings.map((g, i) => <option key={i} value={i}>{g}</option>)}
          </select>
        </Row>
        <Row k="Default task duration" hint="Used for Quick Add and new tasks">
          <div className="flex items-center gap-2">
            <button onClick={() => setPrefs({ ...prefs, defaultDuration: Math.max(1, prefs.defaultDuration - 1) })} className="w-6 h-6 border border-line rounded-[5px] hover:bg-s1">−</button>
            <span className="text-[13.5px] font-medium w-16 text-center">{days(prefs.defaultDuration)}</span>
            <button onClick={() => setPrefs({ ...prefs, defaultDuration: Math.min(60, prefs.defaultDuration + 1) })} className="w-6 h-6 border border-line rounded-[5px] hover:bg-s1">+</button>
          </div>
        </Row>
        <Row k="Working hours" hint="Work blocks are placed here"><Seg value={prefs.workingHours} options={WORKING_HOURS} onChange={(v) => setPrefs({ ...prefs, workingHours: v })} /></Row>
        <Row k="Reminder preference"><Seg value={prefs.reminder} options={REMINDER_PREFERENCES} onChange={(v) => setPrefs({ ...prefs, reminder: v })} /></Row>
        <Row k="Connected services">
          <button onClick={goServices} className="text-[13px] text-ink2 hover:text-ink">{summary}{names && ` — ${names}`} →</button>
        </Row>
      </div>
      <aside className="pt-7">
        <div className="label pb-2 border-b border-line">Preview</div>
        <div className="mt-4"><CompanionCard prefs={prefs} state="welcome" tasks={tasks} /></div>
        <div className="label pt-8 pb-2 border-b border-line">What MIRA has learned</div>
        {insights.map((l) => (
          <div key={l} className="py-2.5 border-b border-line text-[12.5px] text-ink2 leading-relaxed">{l}</div>
        ))}
        {!insights.length && <div className="py-2.5 border-b border-line text-[12.5px] text-mute leading-relaxed">Not enough history yet. Patterns appear here once MIRA has seen a few of your tasks.</div>}
        <button onClick={onResetInsights} className="text-[11.5px] text-mute hover:text-ink2 mt-3">Reset learned preferences</button>
      </aside>
    </div>
  )
}

function ServiceList({ services, toggle, busy }: { services: Services; toggle: (id: ProviderId) => void; busy: ReadonlySet<string> }) {
  return (
    <div className="max-w-[760px]">
      <p className="text-[13px] text-ink2 pt-6 pb-4">MIRA sits above the services you already use. Each one only feeds tasks and time — nothing else.</p>
      {SERVICES.map((s) => {
        const mode = services[s.id] ?? 'disconnected'
        const on = isOn(mode)
        return (
          <div key={s.id} className="grid grid-cols-[36px_1fr_140px_110px] items-center py-3.5 border-t border-line">
            <span className="w-6 h-6 border border-line rounded-[5px] grid place-items-center text-[10.5px] font-medium text-ink2 bg-el">{s.glyph}</span>
            <div><div className="text-[13.5px] font-medium">{s.name}</div><div className="text-[11.5px] text-mute">{s.note}</div></div>
            <span className={`text-[12px] flex items-center gap-1.5 ${mode === 'connected' ? 'text-ink' : mode === 'demo' ? 'text-ink2' : 'text-mute'}`}><span className={`w-1.5 h-1.5 rounded-full ${mode === 'connected' ? 'bg-ink' : mode === 'demo' ? 'bg-mute' : 'border border-mute'}`} />{mode === 'connected' ? 'Connected' : mode === 'demo' ? 'Demo data' : 'Not connected'}</span>
            <div className="text-right"><Btn primary={!on} disabled={busy.has(`integration:${s.id}`)} onClick={() => toggle(s.id)} className="!h-7 !text-[12px]">{on ? 'Disconnect' : 'Connect'}</Btn></div>
          </div>
        )
      })}
      <p className="text-[11.5px] text-mute pt-4 border-t border-line">Account sign-in is not available in this version. Google Calendar and Gmail can be explored with demo data, which is labelled wherever it appears.</p>
    </div>
  )
}

function Gmail({ mode, onAdd, busy }: { mode: ConnectionMode; onAdd: (messageId: string) => Promise<Task | undefined>; busy: ReadonlySet<string> }) {
  const [items, setItems] = useState<MailSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (mode === 'disconnected') return
    let live = true
    api.integrations.suggestions().then((s) => live && setItems(s)).catch((e) => live && setError(errorMessage(e)))
    return () => { live = false }
  }, [mode])
  if (mode === 'disconnected') return <p className="pt-8 text-[13px] text-mute">Gmail is not connected. Connect it in Connected services.</p>
  const add = async (id: string) => {
    const t = await onAdd(id)
    if (t) setItems((all) => all?.map((i) => (i.id === id ? { ...i, importedTaskId: t.id } : i)) ?? all)
  }
  return (
    <div className="max-w-[820px]">
      <div className="flex items-center justify-between pt-6 pb-4">
        <span className="flex items-center gap-2 text-[13px]"><IMail /> Gmail · <span className="text-ink2">{mode === 'demo' ? 'Demo data — no account connected' : 'Connected'}</span></span>
        <span className="text-[11.5px] text-mute">{error ?? (items ? `${mode === 'demo' ? 'Sample messages' : 'Recent messages'} · ${items.filter((i) => !i.importedTaskId).length} possible tasks` : 'Loading…')}</span>
      </div>
      {items?.map((m) => (
        <div key={m.id} className="grid grid-cols-[1fr_110px_130px] gap-6 items-center py-4 border-t border-line">
          <div className="min-w-0">
            <div className="text-[11.5px] text-mute">{m.from}</div>
            <div className="text-[14px] font-medium truncate mt-0.5">{m.subject}</div>
            <div className="text-[12px] text-ink2 truncate mt-0.5">{m.snippet}</div>
          </div>
          <div><div className="label">{m.kind}</div><div className="text-[12.5px] mt-0.5">{m.deadline ? fmt(m.deadline) : '—'}</div></div>
          <div className="text-right">
            {m.importedTaskId ? <span className="text-[12px] text-mute">Added to MIRA</span> : (
              <Btn primary className="!h-7 !text-[12px]" disabled={busy.has(`import:${m.id}`)} onClick={() => void add(m.id)}>Add to MIRA</Btn>
            )}
          </div>
        </div>
      ))}
      <p className="text-[11.5px] text-mute pt-4 border-t border-line">MIRA reads subject lines and message previews only to suggest tasks. Nothing is added without your confirmation.</p>
    </div>
  )
}

function GCal({ mode, account, toggle, opts, setOpt }: { mode: ConnectionMode; account: string | null; toggle: () => void; opts: Record<string, boolean>; setOpt: (k: string, v: boolean) => void }) {
  const on = isOn(mode)
  return (
    <div className="max-w-[760px]">
      <div className="flex items-center justify-between pt-6 pb-5 border-b border-line">
        <span className="flex items-center gap-2 text-[13px]"><ICal /> Google Calendar · <span className="text-ink2">{mode === 'connected' ? `Connected${account ? ` · ${account}` : ''}` : mode === 'demo' ? 'Demo data — no account connected' : 'Not connected'}</span></span>
        <Btn primary={!on} onClick={toggle}>{on ? 'Disconnect' : 'Connect'}</Btn>
      </div>
      <div className="label pt-6 pb-2">How MIRA translates tasks into time</div>
      <div className="py-5 border-y border-line grid grid-cols-[1fr_1fr] gap-10">
        <div>
          <div className="text-[14px] font-medium">Computer Networks Assignment</div>
          <div className="text-[12px] text-ink2 mt-1">7 Oct → 10 Oct · Duration 3 days · Deadline 10 Oct</div>
          <div className="relative h-[6px] bg-s2 mt-4"><div className="absolute inset-y-0 left-0 w-[40%] bg-dark" /><span className="absolute right-0 -top-1 -bottom-1 w-[2px] bg-ink" /></div>
        </div>
        <div className="text-[12px] text-ink2">
          <div className="label mb-2">Becomes</div>
          <div className="py-1">One all-day span, 7 – 10 Oct</div>
          <div className="py-1">3 evening work blocks · 6 – 9 PM</div>
          <div className="py-1">One deadline marker, 10 Oct</div>
        </div>
      </div>
      {([['blocks', 'Write work blocks to Google Calendar'], ['deadlines', 'Show deadlines as all-day events'], ['busy', 'Avoid busy time when planning']] as const).map(([k, l]) => (
        <label key={k} className="flex items-center justify-between py-3.5 border-b border-line text-[13.5px] cursor-pointer">
          {l}
          <button onClick={() => setOpt(k, !opts[k])} className={`w-8 h-[18px] rounded-full relative transition-colors ${opts[k] ? 'bg-dark' : 'bg-line'}`}>
            <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-el transition-all ${opts[k] ? 'left-[16px]' : 'left-[2px]'}`} />
          </button>
        </label>
      ))}
    </div>
  )
}

/* ---------------- COMPANION ---------------- */
export type CState = 'welcome' | 'focus' | 'reminder' | 'quick' | 'done'

export function CompanionCard({ prefs, state, tasks = [], reminder, done, error, onOpen, onQuickAdd, onClose }: {
  prefs: Prefs; state: CState; tasks?: Task[]; reminder?: Reminder | null; done?: Done | null; error?: string | null
  onOpen?: () => void; onQuickAdd?: (title: string) => Promise<boolean>; onClose?: () => void
}) {
  const now = today()
  const active = tasks.filter((t) => !t.completed && t.startDate <= now)
  const focus = focusTask(tasks)
  const left = focus ? remaining(focus) : 0
  const lastDone = tasks.filter((t) => t.completed && completedOn(t) === now).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0]
  const shown = done ?? (lastDone ? { kind: 'completed' as const, title: lastDone.title } : null)
  const [v, setV] = useState('')
  const [sending, setSending] = useState(false)
  return (
    <div className="w-[300px] bg-el border border-line rounded-[10px] shadow-[0_12px_32px_-16px_rgba(28,28,28,0.35)] overflow-hidden">
      <div className="flex items-center justify-between px-4 h-9 border-b border-line">
        <span className="flex items-center gap-2"><span className="flex flex-col gap-[2px]"><span className="w-3 h-px bg-ink" /><span className="w-2 h-px bg-ink" /><span className="w-2.5 h-px bg-ink" /></span><span className="text-[10.5px] font-semibold tracking-[0.2em]">MIRA</span></span>
        {onClose && <button onClick={onClose} className="text-mute hover:text-ink"><IClose /></button>}
      </div>
      <div className="px-4 py-4">
        {state === 'welcome' && <>
          <div className="text-[15px] font-medium">{prefs.greeting}, {prefs.displayName}.</div>
          <div className="text-[12.5px] text-ink2 mt-1">You have {active.length} active task{active.length === 1 ? '' : 's'} today.</div>
        </>}
        {state === 'reminder' && (reminder ? <>
          <div className="label mb-1.5">Reminder</div>
          <div className="text-[14px] font-medium">{reminder.title}</div>
          <div className="text-[12.5px] text-ink2 mt-0.5">{reminder.message}</div>
        </> : <div className="py-2 text-[12.5px] text-ink2">Nothing due soon.</div>)}
        {state === 'done' && (shown ? <>
          <div className="py-2 text-[15px] font-medium">{shown.kind === 'completed' ? 'One less thing.' : 'Added to MIRA.'}</div>
          <div className="text-[12.5px] text-ink2 truncate">{shown.title}</div>
        </> : <div className="py-2 text-[12.5px] text-ink2">Nothing completed yet today.</div>)}
        {state === 'quick' && (
          <form onSubmit={async (e) => {
            e.preventDefault()
            if (!v.trim() || sending || !onQuickAdd) return
            setSending(true)
            if (await onQuickAdd(v.trim())) setV('')
            setSending(false)
          }}>
            <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="What needs to be done?" maxLength={200} className="w-full bg-transparent outline-none text-[14px] placeholder:text-mute" />
            {error && <div role="alert" className="text-[11.5px] text-ink mt-2">{error}</div>}
          </form>
        )}
        {(state === 'welcome' || state === 'focus') && focus && (
          <div className={state === 'welcome' ? 'mt-4 pt-3.5 border-t border-line' : ''}>
            <div className="label mb-1.5">Current focus</div>
            <div className="text-[13.5px] font-medium">{focus.title}</div>
            <div className="text-[12px] text-ink2 mt-0.5">{left < 0 ? `${days(-left)} overdue` : left === 0 ? 'Due today' : `${days(left)} remaining`} · {Math.round(progress(focus) * 100)}%</div>
            <div className="relative h-[2px] bg-s2 mt-3"><div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${progress(focus) * 100}%` }} /></div>
          </div>
        )}
        {state === 'focus' && !focus && <div className="py-2 text-[12.5px] text-ink2">No task in progress right now.</div>}
      </div>
      {onOpen && state !== 'quick' && <button onClick={onOpen} className="w-full text-left px-4 h-9 border-t border-line text-[12.5px] text-ink2 hover:bg-s1 hover:text-ink transition-colors">Open MIRA →</button>}
      {state === 'quick' && <div className="px-4 h-9 border-t border-line text-[11px] text-mute flex items-center justify-between">Enter to add <span>Ctrl + Space</span></div>}
    </div>
  )
}

export function Companion({ prefs, tasks, state, setState, reminder, done, error, onOpen, onQuickAdd }: {
  prefs: Prefs; tasks: Task[]; state: CState | null; setState: (s: CState | null) => void; reminder: Reminder | null; done: Done | null; error: string | null
  onOpen: () => void; onQuickAdd: (t: string) => Promise<boolean>
}) {
  const states: [CState, string][] = [['welcome', 'Welcome'], ['focus', 'Focus'], ['reminder', 'Reminder'], ['quick', 'Quick add'], ['done', 'Completion']]
  return (
    <div className="fixed right-6 bottom-6 z-40 flex flex-col items-end gap-2">
      {state && (
        <div key={state} className="rise">
          <CompanionCard prefs={prefs} state={state} tasks={tasks} reminder={reminder} done={done} error={error}
            onOpen={() => { onOpen(); setState(null) }} onQuickAdd={async (t) => { const ok = await onQuickAdd(t); if (ok) setState('done'); return ok }} onClose={() => setState(null)} />
          <div className="flex gap-1 justify-end mt-2">
            {states.map(([s, l]) => <button key={s} onClick={() => setState(s)} className={`h-6 px-2 text-[10.5px] rounded-[5px] border ${state === s ? 'border-ink2 text-ink bg-el' : 'border-line text-mute hover:text-ink2'}`}>{l}</button>)}
          </div>
        </div>
      )}
      {!state && (
        <button onClick={() => setState('focus')} className="rise h-9 pl-3 pr-4 bg-dark text-el rounded-[8px] flex items-center gap-2.5 text-[12px] hover:bg-dark2 shadow-[0_8px_20px_-12px_rgba(28,28,28,0.6)]">
          <span className="flex flex-col gap-[2px]"><span className="w-3 h-px bg-el" /><span className="w-2 h-px bg-el" /><span className="w-2.5 h-px bg-el" /></span>MIRA
        </button>
      )}
    </div>
  )
}

/* ---------------- QUICK ADD (Ctrl + Space) ---------------- */
export function QuickAdd({ onClose, onAdd, prefs, error, busy }: { onClose: () => void; onAdd: (title: string, deadline: string, key: string) => void; prefs: Prefs; error: string | null; busy: boolean }) {
  const [v, setV] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const key = useRef(newKey())
  useEffect(() => { ref.current?.focus() }, [])
  const now = today()
  const parsed = parseQuickAdd(v, now, prefs.defaultDuration)
  const end = parsed.deadline
  const dur = diffDays(now, end)
  const title = parsed.title
  const submit = () => { if (title && !busy) onAdd(title, end, key.current) }
  return (
    <div className="fixed inset-0 z-50 bg-dark/10 fade" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="rise absolute left-1/2 top-[22%] -translate-x-1/2 w-[560px] bg-el border border-line rounded-[10px] shadow-[0_24px_60px_-24px_rgba(28,28,28,0.45)]">
        <div className="px-5 pt-4 label">What needs to be done?</div>
        <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }} maxLength={200}
          placeholder="Complete CN assignment by 10 Oct" className="w-full px-5 pt-2 pb-4 bg-transparent outline-none text-[18px] placeholder:text-mute" />
        <div className="px-5 pb-4">
          <div className="relative h-[4px] bg-s1"><div className="absolute inset-y-0 left-0 bg-dark transition-all duration-300" style={{ width: `${Math.min(100, ((dur + 1) / 10) * 100)}%` }} /></div>
          <div className="flex justify-between text-[11px] text-mute mt-1.5"><span>Today, {fmt(now)}</span><span>{days(dur)} · deadline {weekday(end)} {fmt(end)}{!parsed.explicit && ' (your usual)'}</span></div>
        </div>
        <div className="flex items-center justify-between px-5 h-11 border-t border-line text-[11.5px] text-mute">
          {error ? <span role="alert" className="text-ink">{error}</span> : <span>Try “by 12” to set a deadline · Esc to close</span>}
          <button onClick={submit} className={`text-[13px] font-medium ${title && !busy ? 'text-ink' : 'text-mute'}`}>{busy ? 'Adding…' : 'Add →'}</button>
        </div>
      </div>
    </div>
  )
}
