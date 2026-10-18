/**
 * Date-only helpers. Task dates are calendar days stored as `YYYY-MM-DD` strings.
 * All arithmetic is done on UTC midnights so DST changes and the runtime's time
 * zone can never move a deadline to a different calendar day.
 */

export type ISODate = string

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false
  const m = ISO_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= daysInMonth(y, mo)
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parts(iso: ISODate): [number, number, number] {
  const m = ISO_RE.exec(iso)
  if (!m) throw new RangeError(`Invalid date: ${iso}`)
  return [+m[1], +m[2], +m[3]]
}

function toUTC(iso: ISODate) {
  const [y, m, d] = parts(iso)
  return Date.UTC(y, m - 1, d)
}

export function fromParts(year: number, month: number, day: number): ISODate {
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.toISOString().slice(0, 10)
}

export function addDays(iso: ISODate, n: number): ISODate {
  return new Date(toUTC(iso) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function diffDays(a: ISODate, b: ISODate) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS)
}

export function dayOfMonth(iso: ISODate) {
  return parts(iso)[2]
}

/** 0 = Sunday … 6 = Saturday, for the calendar day itself (time-zone independent). */
export function dayOfWeek(iso: ISODate) {
  return new Date(toUTC(iso)).getUTCDay()
}

export const isWeekend = (iso: ISODate) => dayOfWeek(iso) % 6 === 0

/**
 * The calendar date and wall-clock position of `now` in a time zone.
 * Without a zone the runtime's local zone is used (the browser's, for the UI).
 */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()
export function zonedParts(now: Date, timeZone?: string) {
  let f = zoneFormatters.get(timeZone ?? '')
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    zoneFormatters.set(timeZone ?? '', f)
  }
  const fp = f.formatToParts(now)
  const get = (type: string) => +(fp.find((p) => p.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

export function localDateOf(now: Date, timeZone?: string): ISODate {
  const p = zonedParts(now, timeZone)
  return fromParts(p.year, p.month, p.day)
}

/** A snapshot of "now" as the task engine sees it: today's date and how far through the day we are. */
export type Clock = { today: ISODate; dayFraction: number; hour: number }

export function clockAt(now: Date, timeZone?: string): Clock {
  const p = zonedParts(now, timeZone)
  const seconds = p.hour * 3600 + p.minute * 60 + p.second
  return { today: fromParts(p.year, p.month, p.day), dayFraction: seconds / 86_400, hour: seconds / 3600 }
}

/* ---------- Display (locale-aware month and weekday names, MIRA's "8 Oct" layout) ---------- */

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function named(iso: ISODate, opts: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) { f = new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }); fmtCache.set(key, f) }
  return f.format(new Date(toUTC(iso)))
}

export const weekdayName = (iso: ISODate) => named(iso, { weekday: 'short' })
export const monthShort = (iso: ISODate) => named(iso, { month: 'short' })
export const monthLong = (iso: ISODate) => named(iso, { month: 'long' })
export const yearOf = (iso: ISODate) => parts(iso)[0]

/** "8 Oct", with the year appended when it differs from the reference year. */
export function shortDate(iso: ISODate, refYear?: number) {
  const base = `${dayOfMonth(iso)} ${monthShort(iso)}`
  return refYear !== undefined && yearOf(iso) !== refYear ? `${base} ${yearOf(iso)}` : base
}

/** "8 October 2026" */
export const longDate = (iso: ISODate) => `${dayOfMonth(iso)} ${monthLong(iso)} ${yearOf(iso)}`

/** "4 – 17 October" or "28 Oct – 10 Nov" */
export function rangeLabel(a: ISODate, b: ISODate) {
  const [ya, ma] = parts(a)
  const [yb, mb] = parts(b)
  if (ya === yb && ma === mb) return `${dayOfMonth(a)} – ${dayOfMonth(b)} ${monthLong(a)}`
  return `${shortDate(a)} – ${shortDate(b)}${ya !== yb ? ` ${yb}` : ''}`
}
