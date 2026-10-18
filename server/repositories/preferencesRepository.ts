import type { Greeting, Preferences, ReminderPreference, WorkingHours } from '../../shared/types'
import type { Db } from '../db/database'

type Row = { display_name: string; greeting: Greeting; default_duration: number; working_hours: WorkingHours; reminder: ReminderPreference; insights_since: string | null; updated_at: string }

const COLUMNS = { displayName: 'display_name', greeting: 'greeting', defaultDuration: 'default_duration', workingHours: 'working_hours', reminder: 'reminder', insightsSince: 'insights_since' } as const
export type PreferenceFields = Partial<{ [K in keyof typeof COLUMNS]: Preferences[K] }>

export class PreferencesRepository {
  constructor(private readonly db: Db) {}

  get(): Preferences {
    const r = this.db.prepare('SELECT * FROM preferences WHERE id = 1').get() as Row | undefined
    if (!r) throw new Error('Preferences row is missing; the database was not initialised.')
    return { displayName: r.display_name, greeting: r.greeting, defaultDuration: r.default_duration, workingHours: r.working_hours, reminder: r.reminder, insightsSince: r.insights_since, updatedAt: r.updated_at }
  }

  update(fields: PreferenceFields, at: string) {
    const entries = (Object.entries(fields) as [keyof typeof COLUMNS, string | number | null][]).filter(([, v]) => v !== undefined)
    const sets = [...entries.map(([k]) => `${COLUMNS[k]} = ?`), 'updated_at = ?']
    this.db.prepare(`UPDATE preferences SET ${sets.join(', ')} WHERE id = 1`).run(...entries.map(([, v]) => v), at)
  }
}
