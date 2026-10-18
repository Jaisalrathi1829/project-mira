import { Task, progress, expected, status, dueText, progressText } from './data'
import { Check } from './icons'

/** The MIRA graphite track: progress fill plus a hairline tick where you should be by now. */
export function Track({ t, className = '', thick = false }: { t: Task; className?: string; thick?: boolean }) {
  const p = progress(t)
  const e = expected(t)
  const st = status(t)
  return (
    <div className={`relative ${thick ? 'h-[3px]' : 'h-[2px]'} bg-s2 ${className}`}>
      <div className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${st === 'At Risk' || st === 'Overdue' ? 'bg-graphite' : 'bg-ink'}`} style={{ width: `${p * 100}%` }} />
      {!t.completed && e > 0 && e < 1 && (
        <div className="absolute -top-[3px] w-px bg-ink2" style={{ left: `${e * 100}%`, height: thick ? 9 : 8 }} title="Expected by now" />
      )}
    </div>
  )
}

export function StatusText({ t }: { t: Task }) {
  const st = status(t)
  const strong = st === 'At Risk' || st === 'Overdue' || st === 'Due Today'
  return (
    <span className={`label !tracking-[0.08em] ${strong ? '!text-ink' : ''}`}>
      {strong && <span className="inline-block w-1 h-1 rounded-full bg-ink mr-1.5 align-middle -translate-y-px" />}
      {st === 'Active' ? 'In progress' : st}
    </span>
  )
}

export function TaskRow({ t, onOpen, onToggle }: { t: Task; onOpen: () => void; onToggle: () => void }) {
  return (
    <div onClick={onOpen} className="group grid grid-cols-[28px_1fr_180px_96px] items-center gap-4 py-3.5 border-b border-line cursor-pointer hover:bg-s1/60 transition-colors -mx-3 px-3 rounded-[6px]">
      <Check done={!!t.completed} onClick={(e) => { e.stopPropagation(); onToggle() }} />
      <div className="min-w-0">
        <div className={`text-[14.5px] font-medium truncate ${t.completed ? 'text-mute line-through decoration-line' : ''}`}>{t.title}</div>
        <div className="text-[12px] text-ink2 mt-0.5">{dueText(t)}{!t.completed && <> · {progressText(t)}</>}</div>
      </div>
      <div>{!t.completed && <Track t={t} />}</div>
      <div className="text-right"><StatusText t={t} /></div>
    </div>
  )
}

export const Btn = ({ children, onClick, primary, disabled, className = '' }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; className?: string }) => (
  <button onClick={onClick} disabled={disabled} className={`h-8 px-3.5 text-[13px] font-medium rounded-[7px] inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-default ${primary ? 'bg-dark text-el hover:bg-dark2' : 'border border-line text-ink hover:bg-s1'} ${className}`}>{children}</button>
)

/** Inline feedback in MIRA's hint style (the same rule-and-text treatment as the duration hint in New task). */
export function Notice({ message, onDismiss, className = '' }: { message: string; onDismiss?: () => void; className?: string }) {
  return (
    <div role="alert" className={`fade flex items-center justify-between gap-4 border-l-2 border-ink pl-3 py-1 ${className}`}>
      <span className="text-[12.5px] text-ink2">{message}</span>
      {onDismiss && <button onClick={onDismiss} className="text-[12.5px] text-mute hover:text-ink2 shrink-0">Dismiss</button>}
    </div>
  )
}
