/**
 * Routes → handlers → services. Handlers only validate input, call one service method and shape the response.
 * Every task-mutating endpoint responds with the full, freshly read task so clients never have to guess state.
 */
import { Router, type Request } from 'express'
import type { ServiceContext } from '../services/context'
import type { IntegrationService } from '../services/integrationService'
import type { PreferencesService, ReminderService } from '../services/preferencesService'
import type { TaskService } from '../services/taskService'
import { idempotent } from './middleware'
import * as s from './schemas'

export type Services = { tasks: TaskService; preferences: PreferencesService; reminders: ReminderService; integrations: IntegrationService }

const taskId = (req: Request) => s.id.parse(req.params.id)
const subtaskId = (req: Request) => s.id.parse(req.params.subtaskId)

export function apiRouter(ctx: ServiceContext, svc: Services, startedAt: Date) {
  const r = Router()
  const once = (handler: Parameters<typeof idempotent>[2]) => idempotent(ctx.repos.idempotency, ctx.now, handler)

  r.get('/health', (_req, res) => {
    ctx.db.prepare('SELECT 1').get()
    res.json({ status: 'ok', database: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000) })
  })

  /* Tasks */
  r.get('/tasks', (req, res) => {
    res.json({ tasks: svc.tasks.list(s.taskQuery.parse(req.query)) })
  })
  r.post('/tasks', once((req, res) => {
    res.status(201).json({ task: svc.tasks.create(s.createTask.parse(req.body)) })
  }))
  r.get('/tasks/:id', (req, res) => {
    res.json({ task: svc.tasks.get(taskId(req), s.todayQuery.parse(req.query).today) })
  })
  r.patch('/tasks/:id', (req, res) => {
    res.json({ task: svc.tasks.update(taskId(req), s.updateTask.parse(req.body)) })
  })
  r.delete('/tasks/:id', (req, res) => {
    svc.tasks.remove(taskId(req))
    res.status(204).end()
  })
  r.post('/tasks/:id/complete', (req, res) => {
    res.json({ task: svc.tasks.complete(taskId(req)) })
  })
  r.post('/tasks/:id/reopen', (req, res) => {
    res.json({ task: svc.tasks.reopen(taskId(req)) })
  })
  r.post('/tasks/:id/count', (req, res) => {
    res.json({ task: svc.tasks.stepCount(taskId(req), s.stepCount.parse(req.body).by) })
  })

  /* Subtasks */
  r.post('/tasks/:id/subtasks', once((req, res) => {
    res.status(201).json({ task: svc.tasks.addSubtask(taskId(req), s.createSubtask.parse(req.body).title) })
  }))
  r.patch('/tasks/:id/subtasks/:subtaskId', (req, res) => {
    res.json({ task: svc.tasks.updateSubtask(taskId(req), subtaskId(req), s.updateSubtask.parse(req.body)) })
  })
  r.delete('/tasks/:id/subtasks/:subtaskId', (req, res) => {
    res.json({ task: svc.tasks.removeSubtask(taskId(req), subtaskId(req)) })
  })

  /* Preferences, insights, reminders */
  r.get('/preferences', (_req, res) => {
    res.json({ preferences: svc.preferences.get() })
  })
  r.patch('/preferences', (req, res) => {
    res.json({ preferences: svc.preferences.update(s.updatePreferences.parse(req.body)) })
  })
  r.get('/insights', (_req, res) => {
    res.json({ insights: svc.preferences.insights() })
  })
  r.get('/reminders', (req, res) => {
    res.json({ reminders: svc.reminders.pending(s.todayQuery.parse(req.query).today) })
  })
  r.post('/reminders/ack', (req, res) => {
    res.json({ recorded: svc.reminders.acknowledge(s.ackReminders.parse(req.body).keys) })
  })

  /* Integrations */
  const provider = (req: Request) => s.provider.parse(req.params.provider)
  r.get('/integrations', (_req, res) => {
    res.json({ integrations: svc.integrations.list() })
  })
  r.get('/integrations/gcal/events', async (req, res) => {
    const { from, to } = s.eventRange.parse(req.query)
    res.json({ events: await svc.integrations.calendarEvents(from, to) })
  })
  r.post('/integrations/gcal/sync', () => {
    svc.integrations.syncCalendar()
  })
  r.get('/integrations/gmail/suggestions', async (_req, res) => {
    res.json({ suggestions: await svc.integrations.mailSuggestions() })
  })
  r.post('/integrations/gmail/suggestions/:messageId/import', async (req, res) => {
    const { task, created } = await svc.integrations.importSuggestion(s.id.parse(req.params.messageId))
    res.status(created ? 201 : 200).json({ task, created })
  })
  r.post('/integrations/:provider/connect', (req, res) => {
    res.json({ integration: svc.integrations.connect(provider(req)) })
  })
  r.post('/integrations/:provider/disconnect', (req, res) => {
    res.json({ integration: svc.integrations.disconnect(provider(req)) })
  })
  r.patch('/integrations/:provider/settings', (req, res) => {
    res.json({ integration: svc.integrations.updateSettings(provider(req), s.integrationSettings.parse(req.body).settings) })
  })

  return r
}
