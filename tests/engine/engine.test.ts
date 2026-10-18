import { describe, expect, it } from 'vitest'
import { clockAt, localDateOf } from '../../shared/dates'
import { dueText, duration, durationDays, expected, pickFocus, progress, progressText, queryTasks, remaining, status } from '../../shared/engine'
import { at, subs, task } from '../helpers'

const now = at('2026-10-08') // the prototype's "8 October, mid-afternoon"

describe('duration', () => {
  it('is the calendar-day difference between start and deadline', () => {
    expect(durationDays('2026-10-07', '2026-10-10')).toBe(3)
    expect(durationDays('2026-10-30', '2026-11-02')).toBe(3)
    expect(durationDays('2026-12-30', '2027-01-02')).toBe(3)
    expect(durationDays('2028-02-27', '2028-03-01')).toBe(3) // leap year
    expect(durationDays('2027-02-27', '2027-03-01')).toBe(2)
    expect(durationDays('2026-10-08', '2026-10-08')).toBe(0)
    expect(duration(task())).toBe(3)
  })
})

describe('progress', () => {
  it('uses subtasks, counts, or completion', () => {
    expect(progress(task({ subtasks: subs(true, true, false, false, false) }))).toBeCloseTo(0.4)
    expect(progress(task({ count: { done: 8, total: 12, unit: 'problems' } }))).toBeCloseTo(8 / 12)
    expect(progress(task())).toBe(0)
    expect(progress(task({ completed: true, subtasks: subs(false) }))).toBe(1)
    expect(progressText(task({ count: { done: 8, total: 12, unit: 'problems' } }))).toBe('8 / 12 problems')
    expect(progressText(task({ subtasks: subs(true, false) }))).toBe('50% complete')
  })

  it('drops again when a subtask is reopened', () => {
    const done = task({ subtasks: subs(true, true) })
    const reopened = task({ subtasks: subs(true, false) })
    expect(progress(done)).toBe(1)
    expect(progress(reopened)).toBe(0.5)
  })

  it('clamps out-of-range counts', () => {
    expect(progress(task({ count: { done: 15, total: 12, unit: 'x' } }))).toBe(1)
    expect(progress(task({ count: { done: -1, total: 12, unit: 'x' } }))).toBe(0)
  })
})

describe('expected progress (pace)', () => {
  it('is the elapsed share of the window, using the time of day', () => {
    expect(expected(task(), now)).toBeCloseTo(1.6 / 3) // 7 → 10 Oct, at 8 Oct 0.6
    expect(expected(task({ startDate: '2026-10-05', deadline: '2026-10-13' }), now)).toBeCloseTo(3.6 / 8)
  })

  it('is 0 before the start and 1 from the deadline day', () => {
    expect(expected(task({ startDate: '2026-10-09', deadline: '2026-10-12' }), now)).toBe(0)
    expect(expected(task({ startDate: '2026-10-05', deadline: '2026-10-08' }), now)).toBe(1)
    expect(expected(task({ startDate: '2026-10-01', deadline: '2026-10-03' }), now)).toBe(1)
  })

  it('treats a same-day task as a one-day window', () => {
    expect(expected(task({ startDate: '2026-10-08', deadline: '2026-10-08' }), at('2026-10-08', 0.25))).toBeCloseTo(0.25)
  })

  it('works across a month boundary', () => {
    expect(expected(task({ startDate: '2026-10-30', deadline: '2026-11-03' }), at('2026-11-01', 0))).toBeCloseTo(2 / 4)
  })
})

describe('status precedence', () => {
  it('Completed beats everything, even an old deadline', () => {
    expect(status(task({ deadline: '2026-10-01', startDate: '2026-09-28', completed: true, completedAt: '2026-10-02T10:00:00Z' }), now)).toBe('Completed')
  })

  it('Overdue when the deadline is before today, regardless of progress', () => {
    expect(status(task({ startDate: '2026-10-04', deadline: '2026-10-07', subtasks: subs(true, true) }), now)).toBe('Overdue')
  })

  it('Due Today on the deadline day', () => {
    expect(status(task({ startDate: '2026-10-07', deadline: '2026-10-08' }), now)).toBe('Due Today')
    expect(status(task({ startDate: '2026-10-08', deadline: '2026-10-08' }), now)).toBe('Due Today')
  })

  it('Upcoming when it starts after today', () => {
    expect(status(task({ startDate: '2026-10-09', deadline: '2026-10-14' }), now)).toBe('Upcoming')
  })

  it('At Risk only when meaningfully behind pace', () => {
    // 5 → 13 Oct, 45% of the window elapsed, 10% done
    expect(status(task({ startDate: '2026-10-05', deadline: '2026-10-13', subtasks: subs(true, ...Array(9).fill(false)) }), now)).toBe('At Risk')
    // 7 → 10 Oct, 53% elapsed, 40% done: behind but not by much
    expect(status(task({ subtasks: subs(true, true, false, false, false) }), now)).toBe('Active')
  })

  it('treats a gap of exactly 25 points as Active', () => {
    expect(status(task({ startDate: '2026-10-08', deadline: '2026-10-10' }), at('2026-10-08', 0.5))).toBe('Active')
    expect(status(task({ startDate: '2026-10-08', deadline: '2026-10-10' }), at('2026-10-08', 0.52))).toBe('At Risk')
  })

  it('evaluates count-based tasks by their count', () => {
    const t = task({ startDate: '2026-10-01', deadline: '2026-10-11', count: { done: 1, total: 10, unit: 'problems' } })
    expect(status(t, now)).toBe('At Risk')
    expect(status({ ...t, count: { done: 7, total: 10, unit: 'problems' } }, now)).toBe('Active')
  })

  it('flips from Due Today to Overdue at local midnight', () => {
    const t = task({ startDate: '2026-10-15', deadline: '2026-10-18' })
    expect(status(t, clockAt(new Date('2026-10-18T18:29:00Z'), 'Asia/Kolkata'))).toBe('Due Today')
    expect(status(t, clockAt(new Date('2026-10-18T18:31:00Z'), 'Asia/Kolkata'))).toBe('Overdue')
  })

  it('depends on the user’s zone, not UTC', () => {
    const t = task({ startDate: '2026-10-15', deadline: '2026-10-18' })
    const instant = new Date('2026-10-18T11:30:00Z')
    expect(status(t, clockAt(instant, 'America/Los_Angeles'))).toBe('Due Today')
    expect(status(t, clockAt(instant, 'Pacific/Auckland'))).toBe('Overdue')
  })
})

describe('remaining days and due text', () => {
  it('counts down and goes negative when overdue', () => {
    expect(remaining(task(), now)).toBe(2)
    expect(remaining(task({ deadline: '2026-10-07', startDate: '2026-10-05' }), now)).toBe(-1)
  })

  it('describes each state', () => {
    expect(dueText(task(), now)).toBe('Due in 2 days')
    expect(dueText(task({ deadline: '2026-10-09' }), now)).toBe('Due in 1 day')
    expect(dueText(task({ deadline: '2026-10-08' }), now)).toBe('Due today')
    expect(dueText(task({ startDate: '2026-10-01', deadline: '2026-10-06' }), now)).toBe('Overdue by 2 days')
    expect(dueText(task({ startDate: '2026-10-09', deadline: '2026-10-14' }), now)).toMatch(/^Starts \S+ 9 \S+$/)
  })

  it('distinguishes the completion day from the deadline', () => {
    const completedAt = new Date().toISOString()
    const c = { today: localDateOf(new Date()), dayFraction: 0.5, hour: 12 }
    expect(dueText(task({ completed: true, completedAt, deadline: '2026-01-01', startDate: '2025-12-30' }), c)).toBe('Completed today')
    expect(dueText(task({ completed: true, completedAt: '2026-10-05T12:00:00Z' }), at('2026-10-20'))).toMatch(/^Completed [56] \S+$/)
  })
})

describe('current focus', () => {
  const cn = task({ id: 'cn', priority: 'High', subtasks: subs(true, true, false, false, false) })
  const dsa = task({ id: 'dsa', priority: 'Medium', startDate: '2026-10-07', deadline: '2026-10-08' })
  const phy = task({ id: 'phy', priority: 'Low', startDate: '2026-10-04', deadline: '2026-10-07' })
  const os = task({ id: 'os', priority: 'High', startDate: '2026-10-09', deadline: '2026-10-14' })

  it('picks the highest-priority task in progress, then the most urgent', () => {
    expect(pickFocus([phy, dsa, cn, os], now)?.id).toBe('cn')
    const dbms = task({ id: 'dbms', priority: 'High', startDate: '2026-10-05', deadline: '2026-10-13', subtasks: subs(true, ...Array(9).fill(false)) })
    expect(pickFocus([cn, dbms], now)?.id).toBe('dbms') // both High; DBMS is at risk
    expect(pickFocus([phy, dsa], now)?.id).toBe('dsa')
  })

  it('ignores completed and not-yet-started tasks, and handles none', () => {
    expect(pickFocus([{ ...cn, completed: true, completedAt: '2026-10-08T10:00:00Z' }, os], now)).toBeUndefined()
    expect(pickFocus([], now)).toBeUndefined()
  })
})

describe('query: filtering and sorting', () => {
  const list = [
    task({ id: 'a', title: 'Write report', deadline: '2026-10-12', priority: 'Low' }),
    task({ id: 'b', title: 'Lab', deadline: '2026-10-08', priority: 'High' }),
    task({ id: 'c', title: 'Done thing', completed: true, completedAt: '2026-10-07T09:00:00Z' }),
    task({ id: 'd', title: 'Later', startDate: '2026-10-11', deadline: '2026-10-15' }),
  ]

  it('filters by status, completion and text', () => {
    expect(queryTasks(list, { status: ['Due Today'] }, now).map((t) => t.id)).toEqual(['b'])
    expect(queryTasks(list, { status: ['Upcoming', 'Completed'] }, now).map((t) => t.id).sort()).toEqual(['c', 'd'])
    expect(queryTasks(list, { completed: false }, now).map((t) => t.id)).not.toContain('c')
    expect(queryTasks(list, { q: 'REPORT' }, now).map((t) => t.id)).toEqual(['a'])
  })

  it('sorts by deadline by default and by any key on request', () => {
    expect(queryTasks(list, {}, now).map((t) => t.id)[0]).toBe('b')
    expect(queryTasks(list, { sort: 'priority' }, now).map((t) => t.id)[0]).toBe('b')
    expect(queryTasks(list, { sort: 'deadline', order: 'desc' }, now).map((t) => t.id)[0]).toBe('d')
    expect(queryTasks(list, { sort: 'title' }, now).map((t) => t.title)).toEqual(['Done thing', 'Lab', 'Later', 'Write report'])
  })
})
