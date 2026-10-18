import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './testServer'

let s: TestServer
afterEach(async () => { await s?.close() })

describe('preferences', () => {
  it('returns defaults and saves validated changes', async () => {
    s = await startServer()
    expect((await s.call('GET', '/preferences')).body.preferences).toMatchObject({
      displayName: 'Mr. Rathi', greeting: 'Welcome', defaultDuration: 3, workingHours: '6 PM – 11 PM', reminder: 'Smart', insightsSince: null,
    })
    const r = await s.call('PATCH', '/preferences', { displayName: '  Jai  ', greeting: 'Good evening', defaultDuration: 5, workingHours: '9 AM – 5 PM', reminder: 'Frequent' })
    expect(r.status).toBe(200)
    expect(r.body.preferences).toMatchObject({ displayName: 'Jai', greeting: 'Good evening', defaultDuration: 5, workingHours: '9 AM – 5 PM', reminder: 'Frequent' })
    expect((await s.call('GET', '/preferences')).body.preferences.displayName).toBe('Jai')
    // New tasks pick up the new defaults.
    expect((await s.call('POST', '/tasks', { title: 'x' })).body.task).toMatchObject({ deadline: '2026-10-13', reminder: 'Frequent' })
  })

  it.each([{}, { displayName: '   ' }, { greeting: 'Hey' }, { defaultDuration: 0 }, { defaultDuration: 61 }, { workingHours: '24/7' }, { reminder: 'Never' }, { theme: 'dark' }])(
    'rejects %j', async (patch) => {
      s = await startServer()
      expect((await s.call('PATCH', '/preferences', patch)).status).toBe(422)
    })

  it('resets learned insights by moving the history cut-off', async () => {
    s = await startServer()
    const r = await s.call('PATCH', '/preferences', { resetInsights: true })
    expect(r.body.preferences.insightsSince).toBe('2026-10-08T09:00:00.000Z')
    expect((await s.call('GET', '/insights')).body.insights).toEqual({ lines: [], assignmentDays: null })
  })
})

describe('reminders', () => {
  it('lists pending reminders and records delivery exactly once', async () => {
    s = await startServer()
    const t = (await s.call('POST', '/tasks', { title: 'Due today', startDate: '2026-10-06', deadline: '2026-10-08' })).body.task
    await s.call('POST', '/tasks', { title: 'Done', startDate: '2026-10-06', deadline: '2026-10-08' }).then((r) => s.call('POST', `/tasks/${r.body.task.id}/complete`))
    const pending = (await s.call('GET', '/reminders')).body.reminders
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ taskId: t.id, kind: 'due-today', title: 'Due today', key: `${t.id}:due-today:2026-10-08` })

    expect((await s.call('POST', '/reminders/ack', { keys: [pending[0].key] })).body.recorded).toBe(1)
    expect((await s.call('POST', '/reminders/ack', { keys: [pending[0].key] })).body.recorded).toBe(0)
    expect((await s.call('GET', '/reminders')).body.reminders).toEqual([])
    expect((await s.call('POST', '/reminders/ack', { keys: ['not a key'] })).status).toBe(422)
  })

  it('follows the reminder preference', async () => {
    s = await startServer()
    await s.call('POST', '/tasks', { title: 'Tomorrow', startDate: '2026-10-08', deadline: '2026-10-09', subtasks: ['a'] })
    expect((await s.call('GET', '/reminders')).body.reminders.map((r: any) => r.kind)).toContain('due-tomorrow')
    await s.call('PATCH', '/preferences', { reminder: 'Minimal' })
    expect((await s.call('GET', '/reminders')).body.reminders).toEqual([])
  })
})

describe('integrations (no real accounts)', () => {
  it('starts disconnected and never reports a demo as connected', async () => {
    s = await startServer()
    const list = (await s.call('GET', '/integrations')).body.integrations
    expect(list.map((i: any) => i.id)).toEqual(['gcal', 'gmail', 'notion', 'slack', 'github', 'drive', 'outlook'])
    expect(list.every((i: any) => i.mode === 'disconnected' && i.account === null)).toBe(true)

    const gmail = await s.call('POST', '/integrations/gmail/connect')
    expect(gmail.body.integration).toMatchObject({ id: 'gmail', mode: 'demo', account: null })
    const notion = await s.call('POST', '/integrations/notion/connect')
    expect(notion.status).toBe(501)
    expect(notion.body.error.code).toBe('NOT_IMPLEMENTED')
    expect((await s.call('POST', '/integrations/myspace/connect')).status).toBe(422)
    expect((await s.call('POST', '/integrations/gmail/disconnect')).body.integration.mode).toBe('disconnected')
  })

  it('refuses to pretend when Google credentials exist but OAuth is not built', async () => {
    s = await startServer({ config: { googleCredentialsConfigured: true } })
    const r = await s.call('POST', '/integrations/gcal/connect')
    expect(r.status).toBe(501)
    expect((await s.call('GET', '/integrations')).body.integrations[0]).toMatchObject({ mode: 'disconnected', credentialsConfigured: true })
  })

  it('never fakes a calendar sync', async () => {
    s = await startServer()
    expect((await s.call('POST', '/integrations/gcal/sync')).status).toBe(409)
    await s.call('POST', '/integrations/gcal/connect')
    const r = await s.call('POST', '/integrations/gcal/sync')
    expect(r.status).toBe(409)
    expect(r.body.error.message).toMatch(/demo data/)
  })

  it('serves demo calendar events only in demo mode, within a bounded range', async () => {
    s = await startServer()
    const range = '?from=2026-10-08&to=2026-10-14'
    expect((await s.call('GET', `/integrations/gcal/events${range}`)).body.events).toEqual([])
    await s.call('POST', '/integrations/gcal/connect')
    const events = (await s.call('GET', `/integrations/gcal/events${range}`)).body.events
    expect(events).toHaveLength(4)
    expect(events.every((e: any) => e.source === 'demo')).toBe(true)
    expect((await s.call('GET', '/integrations/gcal/events?from=2026-10-08&to=2027-01-01')).status).toBe(422)
    expect((await s.call('GET', '/integrations/gcal/events?from=2026-10-08')).status).toBe(422)
  })

  it('persists calendar settings and rejects unknown ones', async () => {
    s = await startServer()
    const r = await s.call('PATCH', '/integrations/gcal/settings', { settings: { busy: false } })
    expect(r.body.integration.settings).toMatchObject({ busy: false })
    expect((await s.call('PATCH', '/integrations/gcal/settings', { settings: { hack: true } })).status).toBe(422)
  })

  it('imports a reviewed mail suggestion once, keeping the source reference', async () => {
    s = await startServer()
    expect((await s.call('GET', '/integrations/gmail/suggestions')).status).toBe(409)
    await s.call('POST', '/integrations/gmail/connect')
    const suggestions = (await s.call('GET', '/integrations/gmail/suggestions')).body.suggestions
    expect(suggestions.map((m: any) => [m.id, m.kind, m.deadline])).toEqual([
      ['m1', 'Deadline', '2026-10-10'], ['m2', 'Request', '2026-10-12'], ['m3', 'Deadline', '2026-10-15'], ['m4', 'Follow-up', null],
    ])

    const first = await s.call('POST', '/integrations/gmail/suggestions/m3/import')
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ created: true, task: { title: 'Resume submission for campus drive', deadline: '2026-10-15', source: 'Gmail', sourceRef: 'demo:m3' } })
    const again = await s.call('POST', '/integrations/gmail/suggestions/m3/import')
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ created: false, task: { id: first.body.task.id } })
    expect((await s.call('GET', '/tasks')).body.tasks).toHaveLength(1)
    expect((await s.call('GET', '/integrations/gmail/suggestions')).body.suggestions[2].importedTaskId).toBe(first.body.task.id)

    const undated = await s.call('POST', '/integrations/gmail/suggestions/m4/import')
    expect(undated.body.task.deadline).toBe('2026-10-11') // default duration
    expect((await s.call('POST', '/integrations/gmail/suggestions/m9/import')).status).toBe(404)
    // The same source reference cannot be created twice through the task API either.
    expect((await s.call('POST', '/tasks', { title: 'dup', source: 'Gmail', sourceRef: 'demo:m3' })).status).toBe(409)
  })
})

describe('local-only access', () => {
  it('rejects untrusted origins, hosts and forwarded clients', async () => {
    s = await startServer()
    expect((await s.call('GET', '/tasks', undefined, { Origin: 'https://evil.example' })).status).toBe(403)
    const ok = await s.call('GET', '/tasks', undefined, { Origin: 'http://localhost:8443' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:8443')
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect((await s.call('GET', '/tasks', undefined, { 'X-Forwarded-For': '192.168.1.20' })).status).toBe(403)
    expect((await s.call('GET', '/tasks', undefined, { 'X-Forwarded-For': '10.0.0.5, 127.0.0.1' })).status).toBe(200)
    expect((await s.call('GET', '/tasks', undefined, { 'X-Forwarded-For': '127.0.0.1, 10.0.0.5' })).status).toBe(403)
    expect((await s.call('OPTIONS', '/tasks', undefined, { Origin: 'http://localhost:8443' })).status).toBe(204)
  })

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    s = await startServer()
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${s.base}/api/tasks`, { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })
})
