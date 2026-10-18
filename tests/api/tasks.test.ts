import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './testServer'

let s: TestServer
beforeEach(async () => { s = await startServer() })
afterEach(async () => { await s.close() })

const create = (body: Record<string, unknown>, headers?: Record<string, string>) => s.call('POST', '/tasks', body, headers)

describe('health', () => {
  it('reports the server and database as up', async () => {
    const r = await s.call('GET', '/health')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'ok', database: 'ok' })
  })
})

describe('task CRUD', () => {
  it('creates a task with defaults from preferences', async () => {
    const r = await create({ title: '  Read chapter 4  ' })
    expect(r.status).toBe(201)
    expect(r.body.task).toMatchObject({
      title: 'Read chapter 4', description: '', startDate: '2026-10-08', deadline: '2026-10-11', durationDays: 3,
      priority: 'Medium', reminder: 'Smart', completed: false, completedAt: null, subtasks: [], count: null, source: null,
      computed: { status: 'Active', asOf: '2026-10-08' },
    })
    expect(r.body.task.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('accepts a duration instead of a deadline, plus subtasks and counts', async () => {
    const r = await create({ title: 'Lab', startDate: '2026-10-30', durationDays: 3, priority: 'High', subtasks: ['Run', 'Write'], reminder: 'Evening' })
    expect(r.body.task).toMatchObject({ deadline: '2026-11-02', durationDays: 3, priority: 'High', reminder: 'Evening' })
    expect(r.body.task.subtasks.map((x: any) => [x.title, x.position, x.done])).toEqual([['Run', 0, false], ['Write', 1, false]])
    const c = await create({ title: 'DSA', count: { done: 2, total: 12, unit: 'problems' } })
    expect(c.body.task.count).toEqual({ done: 2, total: 12, unit: 'problems' })
    expect(c.body.task.computed.progress).toBeCloseTo(2 / 12)
  })

  it('retrieves, lists, updates and deletes', async () => {
    const { body } = await create({ title: 'Essay', startDate: '2026-10-07', deadline: '2026-10-10' })
    const id = body.task.id
    expect((await s.call('GET', `/tasks/${id}`)).body.task.title).toBe('Essay')
    expect((await s.call('GET', '/tasks')).body.tasks.map((t: any) => t.id)).toEqual([id])

    const u = await s.call('PATCH', `/tasks/${id}`, { title: 'Essay v2', description: 'Draft', priority: 'Low', durationDays: 5 })
    expect(u.status).toBe(200)
    expect(u.body.task).toMatchObject({ title: 'Essay v2', description: 'Draft', priority: 'Low', startDate: '2026-10-07', deadline: '2026-10-12', durationDays: 5 })
    expect(u.body.task.updatedAt >= body.task.updatedAt).toBe(true)

    expect((await s.call('DELETE', `/tasks/${id}`)).status).toBe(204)
    expect((await s.call('GET', `/tasks/${id}`)).status).toBe(404)
    expect((await s.call('DELETE', `/tasks/${id}`)).status).toBe(404)
  })

  it('deletes subtasks together with their task', async () => {
    const { body } = await create({ title: 'With steps', subtasks: ['a', 'b'] })
    await s.call('DELETE', `/tasks/${body.task.id}`)
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM subtasks').get() as { n: number }).n).toBe(0)
  })
})

describe('validation and errors', () => {
  it('rejects bad input with a consistent error shape', async () => {
    const r = await create({ title: '' })
    expect(r.status).toBe(422)
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Title is required' })
    expect(r.body.error.details[0].path).toBe('title')
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at .*\.ts/)
  })

  it.each([
    [{ title: 'x', deadline: '2026-02-30' }, 'deadline'],
    [{ title: 'x', startDate: '10/08/2026' }, 'startDate'],
    [{ title: 'x', startDate: '2026-10-10', deadline: '2026-10-08' }, 'deadline'],
    [{ title: 'x', deadline: '2026-10-10', durationDays: 2 }, 'durationDays'],
    [{ title: 'x', priority: 'Urgent' }, 'priority'],
    [{ title: 'x', count: { done: 13, total: 12, unit: 'p' } }, 'count.done'],
    [{ title: 'x', sourceRef: 'm1' }, 'sourceRef'],
    [{ title: 'x', admin: true }, ''],
    [{ title: 'a'.repeat(201) }, 'title'],
  ])('rejects %j', async (body, path) => {
    const r = await create(body)
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('VALIDATION_ERROR')
    if (path) expect(r.body.error.details.map((d: any) => d.path)).toContain(path)
  })

  it('handles malformed JSON, oversized bodies, unknown ids and routes', async () => {
    expect((await create('{"title": ' as unknown as Record<string, unknown>)).body.error.code).toBe('BAD_REQUEST')
    const big = await create({ title: 'x', description: 'y'.repeat(200_000) })
    expect(big.status).toBe(413)
    expect((await s.call('GET', '/tasks/does-not-exist')).status).toBe(404)
    expect((await s.call('GET', '/tasks/bad%20id!')).status).toBe(422)
    const route = await s.call('GET', '/nope')
    expect(route.status).toBe(404)
    expect(route.body.error.code).toBe('NOT_FOUND')
  })

  it('rejects an empty or contradictory update', async () => {
    const { body } = await create({ title: 'x', startDate: '2026-10-08', deadline: '2026-10-10' })
    expect((await s.call('PATCH', `/tasks/${body.task.id}`, {})).status).toBe(422)
    expect((await s.call('PATCH', `/tasks/${body.task.id}`, { startDate: '2026-10-12' })).status).toBe(422)
    expect((await s.call('PATCH', '/tasks/missing', { title: 'y' })).status).toBe(404)
  })

  it('keeps malformed data out even if a bug bypasses validation (database constraints)', () => {
    const insert = (start: string, end: string, extra = 'NULL, NULL, NULL') =>
      s.db.prepare(`INSERT INTO tasks (id, title, description, start_date, deadline, priority, reminder, count_done, count_total, count_unit, created_at, updated_at)
        VALUES ('x', 't', '', ?, ?, 'Low', 'Smart', ${extra}, 'now', 'now')`).run(start, end)
    expect(() => insert('2026-10-10', '2026-10-08')).toThrow(/CHECK/)
    expect(() => insert('2026-02-30', '2026-03-08')).toThrow(/CHECK/)
    expect(() => insert('2026-10-08', '2026-10-10', "13, 12, 'p'")).toThrow(/CHECK/)
  })
})

describe('completion', () => {
  it('sets the completion time once and clears it on reopen', async () => {
    const { body } = await create({ title: 'x' })
    const id = body.task.id
    const first = await s.call('POST', `/tasks/${id}/complete`)
    expect(first.body.task).toMatchObject({ completed: true, completedAt: '2026-10-08T09:00:00.000Z', computed: { status: 'Completed', progress: 1 } })
    const again = await s.call('POST', `/tasks/${id}/complete`)
    expect(again.body.task.completedAt).toBe(first.body.task.completedAt)
    const reopened = await s.call('POST', `/tasks/${id}/reopen`)
    expect(reopened.body.task).toMatchObject({ completed: false, completedAt: null })
    expect((await s.call('POST', `/tasks/${id}/reopen`)).body.task.completed).toBe(false)
    expect((await s.call('POST', '/tasks/missing/complete')).status).toBe(404)
  })
})

describe('subtasks', () => {
  it('supports add, complete, reopen, rename, reorder and delete with progress kept in sync', async () => {
    const { body } = await create({ title: 'Report', subtasks: ['Research', 'Write'] })
    const id = body.task.id
    const added = await s.call('POST', `/tasks/${id}/subtasks`, { title: 'Submit' })
    expect(added.status).toBe(201)
    const subsOf = (r: any) => r.body.task.subtasks as any[]
    expect(subsOf(added).map((x) => x.title)).toEqual(['Research', 'Write', 'Submit'])

    const [research, write, submit] = subsOf(added)
    const done = await s.call('PATCH', `/tasks/${id}/subtasks/${research.id}`, { done: true })
    expect(subsOf(done)[0]).toMatchObject({ done: true, completedAt: '2026-10-08T09:00:00.000Z' })
    expect(done.body.task.computed.progress).toBeCloseTo(1 / 3)

    const undone = await s.call('PATCH', `/tasks/${id}/subtasks/${research.id}`, { done: false })
    expect(subsOf(undone)[0]).toMatchObject({ done: false, completedAt: null })
    expect(undone.body.task.computed.progress).toBe(0)

    const renamed = await s.call('PATCH', `/tasks/${id}/subtasks/${write.id}`, { title: 'Write draft', position: 0 })
    expect(subsOf(renamed).map((x) => [x.title, x.position])).toEqual([['Write draft', 0], ['Research', 1], ['Submit', 2]])

    const removed = await s.call('DELETE', `/tasks/${id}/subtasks/${research.id}`)
    expect(subsOf(removed).map((x) => [x.title, x.position])).toEqual([['Write draft', 0], ['Submit', 1]])

    expect((await s.call('PATCH', `/tasks/${id}/subtasks/${research.id}`, { done: true })).status).toBe(404)
    expect((await s.call('PATCH', `/tasks/${id}/subtasks/${submit.id}`, {})).status).toBe(422)
    expect((await s.call('POST', `/tasks/${id}/subtasks`, { title: ' ' })).status).toBe(422)
  })

  it('will not touch a subtask through another task', async () => {
    const a = (await create({ title: 'A', subtasks: ['a1'] })).body.task
    const b = (await create({ title: 'B' })).body.task
    expect((await s.call('PATCH', `/tasks/${b.id}/subtasks/${a.subtasks[0].id}`, { done: true })).status).toBe(404)
    expect((await s.call('DELETE', `/tasks/${b.id}/subtasks/${a.subtasks[0].id}`)).status).toBe(404)
  })
})

describe('count-based progress', () => {
  it('steps the count without going below zero or above the total', async () => {
    const { body } = await create({ title: 'DSA', count: { done: 11, total: 12, unit: 'problems' } })
    const id = body.task.id
    const step = (by: number) => s.call('POST', `/tasks/${id}/count`, { by })
    expect((await step(1)).body.task.count.done).toBe(12)
    expect((await step(1)).body.task.count.done).toBe(12)
    expect((await step(-100)).body.task.count.done).toBe(0)
    expect((await step(-1)).body.task.count.done).toBe(0)
    expect((await step(0)).status).toBe(422)
    const plain = (await create({ title: 'No count' })).body.task
    expect((await s.call('POST', `/tasks/${plain.id}/count`, { by: 1 })).status).toBe(409)
  })

  it('can add or remove counting through an update', async () => {
    const { body } = await create({ title: 'Reading' })
    const withCount = await s.call('PATCH', `/tasks/${body.task.id}`, { count: { done: 0, total: 5, unit: 'chapters' } })
    expect(withCount.body.task.count).toEqual({ done: 0, total: 5, unit: 'chapters' })
    expect((await s.call('PATCH', `/tasks/${body.task.id}`, { count: null })).body.task.count).toBeNull()
  })
})

describe('filtering and sorting', () => {
  it('filters by computed status and completion, and sorts', async () => {
    await create({ title: 'Overdue', startDate: '2026-10-01', deadline: '2026-10-07', priority: 'Low' })
    await create({ title: 'Due', startDate: '2026-10-06', deadline: '2026-10-08', priority: 'High' })
    const later = (await create({ title: 'Later', startDate: '2026-10-10', deadline: '2026-10-12' })).body.task
    await s.call('POST', `/tasks/${later.id}/complete`)

    const titles = async (q: string) => (await s.call('GET', `/tasks${q}`)).body.tasks.map((t: any) => t.title)
    expect(await titles('?status=Overdue,Due%20Today')).toEqual(['Overdue', 'Due'])
    expect(await titles('?completed=true')).toEqual(['Later'])
    expect(await titles('?sort=priority')).toEqual(['Due', 'Later', 'Overdue'])
    expect(await titles('?sort=deadline&order=desc')).toEqual(['Later', 'Due', 'Overdue'])
    expect(await titles('?q=due')).toEqual(['Overdue', 'Due'])
    expect(await titles('?status=Overdue&today=2026-10-06')).toEqual([])
    expect((await s.call('GET', '/tasks?status=Late')).status).toBe(422)
    expect((await s.call('GET', '/tasks?sort=evil')).status).toBe(422)
  })
})

describe('duplicate requests', () => {
  it('applies a retried create once when it carries the same Idempotency-Key', async () => {
    const key = { 'Idempotency-Key': 'create-abc-123' }
    const first = await create({ title: 'Once' }, key)
    const retry = await create({ title: 'Once' }, key)
    expect(first.status).toBe(201)
    expect(retry.status).toBe(201)
    expect(retry.body.task.id).toBe(first.body.task.id)
    expect(retry.headers.get('idempotent-replayed')).toBe('true')
    expect((await s.call('GET', '/tasks')).body.tasks).toHaveLength(1)
  })

  it('rejects a reused key with a different body, and malformed keys', async () => {
    await create({ title: 'One' }, { 'Idempotency-Key': 'same-key-0001' })
    expect((await create({ title: 'Two' }, { 'Idempotency-Key': 'same-key-0001' })).status).toBe(422)
    expect((await create({ title: 'Two' }, { 'Idempotency-Key': 'bad key' })).status).toBe(400)
  })

  it('does not record failed requests, so a corrected retry works', async () => {
    const key = { 'Idempotency-Key': 'retry-after-fix' }
    expect((await create({ title: '' }, key)).status).toBe(422)
    expect((await create({ title: '' }, key)).status).toBe(422)
  })

  it('deduplicates subtask creation too', async () => {
    const { body } = await create({ title: 'Parent' })
    const key = { 'Idempotency-Key': 'sub-key-0001' }
    await s.call('POST', `/tasks/${body.task.id}/subtasks`, { title: 'Step' }, key)
    const again = await s.call('POST', `/tasks/${body.task.id}/subtasks`, { title: 'Step' }, key)
    expect(again.body.task.subtasks).toHaveLength(1)
  })
})
