/**
 * Demo providers: clearly labelled sample data that lets the Calendar and Gmail screens be explored without a
 * Google account. Dates are generated relative to today so the samples stay meaningful.
 */
import { ISODate, addDays, dayOfMonth, dayOfWeek } from '../../shared/dates'
import type { CalendarEvent } from '../../shared/types'
import type { CalendarProvider, MailMessage, MailProvider, SyncResult } from './types'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// Sample text is always English so the extraction rules can read it, whatever the UI locale.
const spelled = (iso: ISODate) => `${dayOfMonth(iso)} ${MONTH_NAMES[+iso.slice(5, 7) - 1]}`

export class DemoCalendarProvider implements CalendarProvider {
  readonly kind = 'demo' as const
  constructor(private readonly today: () => ISODate) {}

  async listEvents(range: { from: ISODate; to: ISODate }): Promise<CalendarEvent[]> {
    const d = this.today()
    const events: CalendarEvent[] = [
      { id: 'demo-e1', date: d, from: 10, to: 11.5, title: 'Networks lecture', source: 'demo' },
      { id: 'demo-e2', date: addDays(d, 1), from: 14, to: 15, title: 'Project sync', source: 'demo' },
      { id: 'demo-e3', date: addDays(d, 2), from: 9, to: 10, title: 'Lab session', source: 'demo' },
      { id: 'demo-e4', date: addDays(d, 4), from: 11, to: 12.5, title: 'DBMS viva', source: 'demo' },
    ]
    return events.filter((e) => e.date >= range.from && e.date <= range.to)
  }

  async syncWrites(): Promise<SyncResult> {
    throw new Error('Demo calendars cannot be written to.')
  }
}

export class DemoMailProvider implements MailProvider {
  readonly kind = 'demo' as const
  constructor(private readonly today: () => ISODate) {}

  async listMessages(): Promise<MailMessage[]> {
    const d = this.today()
    const due = addDays(d, 2)
    const review = addDays(d, 4)
    const at = `${d}T09:00:00.000Z`
    return [
      { id: 'm1', from: 'Prof. Mehta', subject: 'Assignment submission — Computer Networks', snippet: `Please submit your report on congestion control by ${WEEKDAY_NAMES[dayOfWeek(due)]} ${spelled(due)}, 11:59 PM…`, receivedAt: at },
      { id: 'm2', from: 'Ananya Iyer', subject: 'Can you review the DBMS schema?', snippet: `Shared the ER diagram — could you take a look before ${WEEKDAY_NAMES[dayOfWeek(review)]}?`, receivedAt: at },
      { id: 'm3', from: 'Placement Cell', subject: 'Resume submission for campus drive', snippet: `Upload an updated resume to the portal no later than ${spelled(addDays(d, 7))}.`, receivedAt: at },
      { id: 'm4', from: 'Rohan', subject: 'Follow-up: OS lab partner', snippet: 'Let me know which slot works for the scheduling experiments.', receivedAt: at },
    ]
  }
}

