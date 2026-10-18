import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { Config } from './config'
import type { Db } from './db/database'
import { errorHandler, localOnly, noStore, notFoundRoute } from './http/middleware'
import { apiRouter } from './http/routes'
import { createContext } from './services/context'
import { IntegrationService } from './services/integrationService'
import { PreferencesService, ReminderService } from './services/preferencesService'
import { TaskService } from './services/taskService'

export type AppOptions = {
  db: Db
  config: Pick<Config, 'allowedHosts' | 'allowedOrigins' | 'staticDir' | 'timeZone' | 'googleCredentialsConfigured' | 'logRequests'>
  now?: () => Date
  log?: (msg: string, err?: unknown) => void
}

export function createApp({ db, config, now, log = defaultLog }: AppOptions) {
  const ctx = createContext(db, { now, timeZone: config.timeZone })
  const tasks = new TaskService(ctx)
  const services = { tasks, preferences: new PreferencesService(ctx), reminders: new ReminderService(ctx), integrations: new IntegrationService(ctx, tasks, config.googleCredentialsConfigured) }

  const app = express()
  app.disable('x-powered-by')
  app.set('query parser', 'simple')

  if (config.logRequests) {
    app.use((req, res, next) => {
      const start = performance.now()
      // Method, path and status only: bodies may contain private task or mail content.
      res.on('finish', () => log(`${req.method} ${req.path} ${res.statusCode} ${Math.round(performance.now() - start)}ms`))
      next()
    })
  }

  app.use('/api', localOnly(config), noStore, express.json({ limit: '100kb' }), apiRouter(ctx, services, new Date()), notFoundRoute)

  if (config.staticDir) {
    const index = path.join(config.staticDir, 'index.html')
    if (!existsSync(index)) throw new Error(`No built frontend at ${config.staticDir}. Run "pnpm build" first.`)
    app.use(localOnly(config), express.static(config.staticDir, { index: false }))
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(index))
  }

  app.use(errorHandler(log))
  return app
}

function defaultLog(msg: string, err?: unknown) {
  if (err) console.error(`[mira] ${msg}:`, err instanceof Error ? err.stack ?? err.message : err)
  else console.log(`[mira] ${msg}`)
}
