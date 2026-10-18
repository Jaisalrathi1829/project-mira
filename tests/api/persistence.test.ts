import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../server/db/database'
import { initializeDatabase } from '../../server/db/initialize'
import { LATEST_VERSION, migrate } from '../../server/db/migrations'
import { TEST_NOW, startServer } from './testServer'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mira-test-'))
  file = path.join(dir, 'mira.sqlite')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const count = (db: ReturnType<typeof openDatabase>, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('database initialisation', () => {
  it('seeds the demo tasks only on the first run, relative to that day', () => {
    const db = openDatabase(file)
    expect(initializeDatabase(db, { seed: true, now: TEST_NOW, timeZone: 'UTC' })).toEqual({ firstRun: true, seeded: true })
    expect(count(db, 'tasks')).toBe(7)
    const cn = db.prepare("SELECT start_date, deadline, source_ref FROM tasks WHERE title = 'Computer Networks Assignment'").get()
    expect({ ...cn }).toEqual({ start_date: '2026-10-07', deadline: '2026-10-10', source_ref: 'demo:m1' })
    expect((db.prepare("SELECT mode FROM integrations WHERE provider = 'gcal'").get() as { mode: string }).mode).toBe('demo')
    db.close()

    const again = openDatabase(file)
    expect(initializeDatabase(again, { seed: true, now: new Date('2026-11-01T09:00:00Z') })).toEqual({ firstRun: false, seeded: false })
    expect(count(again, 'tasks')).toBe(7)
    expect(count(again, 'subtasks')).toBe(20)
    again.close()
  })

  it('never re-seeds after the user deletes everything', () => {
    const db = openDatabase(file)
    initializeDatabase(db, { seed: true, now: TEST_NOW })
    db.exec('DELETE FROM tasks')
    db.close()
    const again = openDatabase(file)
    initializeDatabase(again, { seed: true, now: TEST_NOW })
    expect(count(again, 'tasks')).toBe(0)
    again.close()
  })

  it('can start empty, without demo data', () => {
    const db = openDatabase(file)
    initializeDatabase(db, { seed: false, now: TEST_NOW })
    expect(count(db, 'tasks')).toBe(0)
    expect((db.prepare("SELECT mode FROM integrations WHERE provider = 'gmail'").get() as { mode: string }).mode).toBe('disconnected')
    db.close()
  })

  it('applies migrations once and refuses a database from a newer version', () => {
    const db = openDatabase(file)
    migrate(db)
    migrate(db)
    expect((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(LATEST_VERSION)
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'future', 'now')").run()
    expect(() => initializeDatabase(db, { seed: true })).toThrow(/newer than this version/)
    db.close()
  })
})

describe('data survives a restart', () => {
  it('keeps tasks, subtasks, completion and preferences across server restarts', async () => {
    const a = await startServer({ dbPath: file, seed: false })
    const created = (await a.call('POST', '/tasks', { title: 'Persist me', subtasks: ['one', 'two'], startDate: '2026-10-07', deadline: '2026-10-10' })).body.task
    await a.call('PATCH', `/tasks/${created.id}/subtasks/${created.subtasks[0].id}`, { done: true })
    const doneTask = (await a.call('POST', '/tasks', { title: 'Finished' })).body.task
    await a.call('POST', `/tasks/${doneTask.id}/complete`)
    await a.call('PATCH', '/preferences', { displayName: 'Jai', workingHours: '2 PM – 8 PM' })
    await a.close()

    const b = await startServer({ dbPath: file, seed: true })
    const tasks = (await b.call('GET', '/tasks')).body.tasks
    expect(tasks.map((t: any) => t.title).sort()).toEqual(['Finished', 'Persist me'])
    const persisted = tasks.find((t: any) => t.id === created.id)
    expect(persisted.subtasks.map((x: any) => [x.title, x.done])).toEqual([['one', true], ['two', false]])
    expect(persisted.computed.progress).toBe(0.5)
    expect(tasks.find((t: any) => t.id === doneTask.id)).toMatchObject({ completed: true, completedAt: '2026-10-08T09:00:00.000Z' })
    expect((await b.call('GET', '/preferences')).body.preferences).toMatchObject({ displayName: 'Jai', workingHours: '2 PM – 8 PM' })
    await b.close()
  })
})
