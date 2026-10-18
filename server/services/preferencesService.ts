import { ISODate } from '../../shared/dates'
import { computeInsights } from '../../shared/insights'
import { pendingReminders } from '../../shared/reminders'
import type { Preferences, UpdatePreferencesInput } from '../../shared/types'
import { invalid } from '../errors'
import { ServiceContext, clockOf } from './context'

export class PreferencesService {
  constructor(private readonly ctx: ServiceContext) {}

  get(): Preferences {
    return this.ctx.repos.preferences.get()
  }

  update(patch: UpdatePreferencesInput): Preferences {
    const { resetInsights, ...fields } = patch
    const at = this.ctx.now().toISOString()
    this.ctx.repos.preferences.update({ ...fields, ...(resetInsights ? { insightsSince: at } : {}) }, at)
    return this.get()
  }

  insights() {
    return computeInsights(this.ctx.repos.tasks.list(), this.get().insightsSince, this.ctx.timeZone)
  }
}

const KEY_RE = /^([A-Za-z0-9_-]{1,64}):([a-z-]+):([0-9~-]{10,21})$/

export class ReminderService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Reminders that apply now and have not been delivered yet. */
  pending(today?: ISODate) {
    const { tasks, preferences, reminders } = this.ctx.repos
    return pendingReminders(tasks.list(), preferences.get().reminder, clockOf(this.ctx, today), reminders.deliveredKeys())
  }

  /** Records delivery; acknowledging the same key twice is harmless. */
  acknowledge(keys: string[]) {
    const entries = keys.map((key) => {
      const m = KEY_RE.exec(key)
      if (!m) throw invalid('Unrecognised reminder key.', [{ path: 'keys', message: key }])
      return { key, taskId: m[1] }
    })
    return this.ctx.repos.reminders.record(entries, this.ctx.now().toISOString())
  }
}
