import { Clock, ISODate, clockAt } from '../../shared/dates'
import type { Db } from '../db/database'
import { IntegrationRepository } from '../repositories/integrationRepository'
import { IdempotencyRepository, ReminderRepository } from '../repositories/miscRepositories'
import { PreferencesRepository } from '../repositories/preferencesRepository'
import { TaskRepository } from '../repositories/taskRepository'

export type ServiceContext = {
  db: Db
  now: () => Date
  timeZone?: string
  repos: {
    tasks: TaskRepository
    preferences: PreferencesRepository
    integrations: IntegrationRepository
    reminders: ReminderRepository
    idempotency: IdempotencyRepository
  }
}

export function createContext(db: Db, opts: { now?: () => Date; timeZone?: string } = {}): ServiceContext {
  return {
    db,
    now: opts.now ?? (() => new Date()),
    timeZone: opts.timeZone,
    repos: {
      tasks: new TaskRepository(db),
      preferences: new PreferencesRepository(db),
      integrations: new IntegrationRepository(db),
      reminders: new ReminderRepository(db),
      idempotency: new IdempotencyRepository(db),
    },
  }
}

/** "Now" for the engine. A client may pass its own calendar day so status matches what the user sees. */
export function clockOf(ctx: ServiceContext, today?: ISODate): Clock {
  const c = clockAt(ctx.now(), ctx.timeZone)
  return today ? { ...c, today } : c
}
