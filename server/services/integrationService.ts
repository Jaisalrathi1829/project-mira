import { ISODate, diffDays } from '../../shared/dates'
import type { CalendarEvent, IntegrationStatus, MailSuggestion, ProviderId } from '../../shared/types'
import { PROVIDER_IDS } from '../../shared/types'
import { AppError, conflict, invalid, notFound, notImplemented } from '../errors'
import { DemoCalendarProvider, DemoMailProvider } from '../integrations/demo'
import { extractSuggestion } from '../integrations/mailExtraction'
import { ServiceContext, clockOf } from './context'
import { TaskService } from './taskService'

type ProviderMeta = { name: string; demo: boolean; google: boolean; settings: string[] }
const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  gcal: { name: 'Google Calendar', demo: true, google: true, settings: ['blocks', 'deadlines', 'busy'] },
  gmail: { name: 'Gmail', demo: true, google: true, settings: [] },
  notion: { name: 'Notion', demo: false, google: false, settings: [] },
  slack: { name: 'Slack', demo: false, google: false, settings: [] },
  github: { name: 'GitHub', demo: false, google: false, settings: [] },
  drive: { name: 'Google Drive', demo: false, google: false, settings: [] },
  outlook: { name: 'Microsoft Outlook', demo: false, google: false, settings: [] },
}

export const MAIL_SOURCE = 'Gmail'
export const demoRef = (messageId: string) => `demo:${messageId}`

export class IntegrationService {
  private readonly calendar: DemoCalendarProvider
  private readonly mail: DemoMailProvider

  constructor(private readonly ctx: ServiceContext, private readonly tasks: TaskService, private readonly googleCredentialsConfigured: boolean) {
    const today = () => clockOf(ctx).today
    this.calendar = new DemoCalendarProvider(today)
    this.mail = new DemoMailProvider(today)
  }

  list(): IntegrationStatus[] {
    const rows = this.ctx.repos.integrations.all()
    return PROVIDER_IDS.map((id) => {
      const meta = PROVIDERS[id]
      const row = rows.get(id)
      return {
        id, name: meta.name, mode: row?.mode ?? 'disconnected', demoAvailable: meta.demo,
        credentialsConfigured: meta.google && this.googleCredentialsConfigured,
        account: row?.account ?? null, lastSyncedAt: row?.lastSyncedAt ?? null, settings: row?.settings ?? {},
      }
    })
  }

  private status(id: ProviderId) {
    return this.list().find((s) => s.id === id)!
  }

  /**
   * Real OAuth is not implemented yet. Providers with sample data switch to demo mode; others report that the
   * integration is not available. Nothing is ever marked `connected` without an authorised account.
   */
  connect(id: ProviderId): IntegrationStatus {
    const meta = PROVIDERS[id]
    if (meta.google && this.googleCredentialsConfigured) throw notImplemented(`Google credentials are configured, but the ${meta.name} sign-in flow is not implemented in this version.`)
    if (!meta.demo) throw notImplemented(`The ${meta.name} integration is not available yet.`)
    this.ctx.repos.integrations.upsert(id, { mode: 'demo', account: null }, this.ctx.now().toISOString())
    return this.status(id)
  }

  disconnect(id: ProviderId): IntegrationStatus {
    this.ctx.repos.integrations.upsert(id, { mode: 'disconnected', account: null, lastSyncedAt: null }, this.ctx.now().toISOString())
    return this.status(id)
  }

  updateSettings(id: ProviderId, settings: Record<string, boolean>): IntegrationStatus {
    const allowed = PROVIDERS[id].settings
    const unknown = Object.keys(settings).filter((k) => !allowed.includes(k))
    if (unknown.length) throw invalid(`Unknown ${PROVIDERS[id].name} setting.`, unknown.map((k) => ({ path: `settings.${k}`, message: 'Not a recognised setting' })))
    const current = this.ctx.repos.integrations.get(id)?.settings ?? {}
    this.ctx.repos.integrations.upsert(id, { settings: { ...current, ...settings } }, this.ctx.now().toISOString())
    return this.status(id)
  }

  /** Never pretends to sync: only a connected account could be synchronised. */
  syncCalendar(): never {
    const { mode } = this.status('gcal')
    if (mode === 'demo') throw conflict('Google Calendar is showing demo data. Connect a Google account to sync.')
    if (mode === 'disconnected') throw conflict('Google Calendar is not connected.')
    throw notImplemented('Google Calendar sync is not implemented in this version.')
  }

  async calendarEvents(from: ISODate, to: ISODate): Promise<CalendarEvent[]> {
    if (to < from || diffDays(from, to) > 62) throw invalid('Choose a range of up to 62 days.', [{ path: 'to', message: 'Must be within 62 days after from' }])
    return this.status('gcal').mode === 'demo' ? this.calendar.listEvents({ from, to }) : []
  }

  private requireMail() {
    const { mode } = this.status('gmail')
    if (mode === 'disconnected') throw conflict('Gmail is not connected.')
  }

  async mailSuggestions(): Promise<MailSuggestion[]> {
    this.requireMail()
    const today = clockOf(this.ctx).today
    const messages = await this.mail.listMessages()
    return messages.flatMap((m) => {
      const s = extractSuggestion(m, today)
      if (!s) return []
      return [{ ...s, importedTaskId: this.ctx.repos.tasks.findBySource(MAIL_SOURCE, demoRef(m.id))?.id ?? null }]
    })
  }

  /** Creates a task from a reviewed suggestion. Importing the same message twice returns the existing task. */
  async importSuggestion(messageId: string) {
    const suggestion = (await this.mailSuggestions()).find((s) => s.id === messageId)
    if (!suggestion) throw notFound('Message')
    const existing = this.ctx.repos.tasks.findBySource(MAIL_SOURCE, demoRef(messageId))
    if (existing) return { task: this.tasks.view(existing), created: false }
    try {
      const task = this.tasks.create({ title: suggestion.subject, deadline: suggestion.deadline ?? undefined, source: MAIL_SOURCE, sourceRef: demoRef(messageId) })
      return { task, created: true }
    } catch (err) {
      const raced = err instanceof AppError && err.code === 'CONFLICT' && this.ctx.repos.tasks.findBySource(MAIL_SOURCE, demoRef(messageId))
      if (raced) return { task: this.tasks.view(raced), created: false }
      throw err
    }
  }
}
