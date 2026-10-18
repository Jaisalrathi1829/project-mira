/**
 * Quick Add parsing: "Complete CN assignment by 10 Oct" → title + deadline.
 * Understands "by|due" followed by today, tomorrow, a weekday, a day number ("by 12"),
 * or a day and month in either order ("by 12 Nov", "due Nov 12"). Dates resolve to the next
 * occurrence on or after today. Without a date the user's default duration applies.
 */
import { ISODate, addDays, dayOfWeek, daysInMonth, fromParts } from './dates'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?'
const WEEKDAY = '(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|s|rs|r)?'

const PATTERNS: { re: RegExp; resolve: (m: RegExpExecArray, today: ISODate) => ISODate | null }[] = [
  { re: new RegExp(`\\b(?:by|due)\\s+(today|tomorrow)\\b`, 'i'), resolve: (m, today) => (m[1].toLowerCase() === 'today' ? today : addDays(today, 1)) },
  { re: new RegExp(`\\b(?:by|due)\\s+${DAY}\\s+${MONTH}\\b`, 'i'), resolve: (m, today) => nextDayMonth(+m[1], monthIndex(m[2]), today) },
  { re: new RegExp(`\\b(?:by|due)\\s+${MONTH}\\s+${DAY}\\b`, 'i'), resolve: (m, today) => nextDayMonth(+m[2], monthIndex(m[1]), today) },
  { re: new RegExp(`\\b(?:by|due)\\s+${DAY}\\b`, 'i'), resolve: (m, today) => nextDay(+m[1], today) },
  { re: new RegExp(`\\b(?:by|due)\\s+${WEEKDAY}\\b`, 'i'), resolve: (m, today) => addDays(today, (WEEKDAYS.indexOf(m[1].toLowerCase()) - dayOfWeek(today) + 7) % 7) },
]

const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1

function nextDayMonth(day: number, month: number, today: ISODate): ISODate | null {
  const year = +today.slice(0, 4)
  // Up to four years ahead so "29 Feb" finds the next leap year.
  for (let y = year; y <= year + 4; y++) {
    if (day < 1 || day > daysInMonth(y, month)) continue
    const iso = fromParts(y, month, day)
    if (iso >= today) return iso
  }
  return null
}

function nextDay(day: number, today: ISODate): ISODate | null {
  if (day < 1 || day > 31) return null
  let year = +today.slice(0, 4)
  let month = +today.slice(5, 7)
  for (let i = 0; i < 13; i++) {
    if (day <= daysInMonth(year, month)) {
      const iso = fromParts(year, month, day)
      if (iso >= today) return iso
    }
    month = month === 12 ? 1 : month + 1
    if (month === 1) year++
  }
  return null
}

/**
 * Finds the first date mentioned anywhere in free text ("by Saturday 10 October", "before Monday",
 * "no later than 15 Oct"). Weekdays resolve to their next occurrence after today.
 */
export function findDateInText(text: string, today: ISODate): ISODate | null {
  const dm = new RegExp(`\\b${DAY}\\s+${MONTH}\\b`, 'i').exec(text)
  if (dm) return nextDayMonth(+dm[1], monthIndex(dm[2]), today)
  const md = new RegExp(`\\b${MONTH}\\s+${DAY}\\b`, 'i').exec(text)
  if (md) return nextDayMonth(+md[2], monthIndex(md[1]), today)
  const wd = new RegExp(`\\b${WEEKDAY}\\b`, 'i').exec(text)
  if (wd) return addDays(today, ((WEEKDAYS.indexOf(wd[1].toLowerCase()) - dayOfWeek(today) + 6) % 7) + 1)
  return null
}

export type QuickAddParse = { title: string; deadline: ISODate; explicit: boolean }

export function parseQuickAdd(text: string, today: ISODate, defaultDuration: number): QuickAddParse {
  for (const { re, resolve } of PATTERNS) {
    const m = re.exec(text)
    if (!m) continue
    const deadline = resolve(m, today)
    // A date phrase that names an impossible day ("by 31 Nov") is left in the title rather than reinterpreted.
    if (!deadline) break
    const title = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()
    return { title, deadline, explicit: true }
  }
  return { title: text.replace(/\s+/g, ' ').trim(), deadline: addDays(today, defaultDuration), explicit: false }
}

