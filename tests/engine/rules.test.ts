import { describe, expect, it } from 'vitest'
import { computeInsights } from '../../shared/insights'
import { planWorkBlocks } from '../../shared/planner'
import { findDateInText, parseQuickAdd } from '../../shared/quickAdd'
import { computeReminders, pendingReminders, remindersFor } from '../../shared/reminders'
import { at, subs, task } from '../helpers'

describe('Quick Add parsing', () => {
  const today = '2026-10-18' // Sunday

  it('uses the default duration without a date', () => {
    expect(parseQuickAdd('Read chapter 4', today, 3)).toEqual({ title: 'Read chapter 4', deadline: '2026-10-21', explicit: false })
  })

  it('understands day numbers, day-month and month-day', () => {
    expect(parseQuickAdd('Complete CN assignment by 25 Oct', today, 3)).toEqual({ title: 'Complete CN assignment', deadline: '2026-10-25', explicit: true })
    expect(parseQuickAdd('Essay due Nov 3', today, 3).deadline).toBe('2026-11-03')
    expect(parseQuickAdd('Lab by 20', today, 3).deadline).toBe('2026-10-20')
    expect(parseQuickAdd('Lab by 21st', today, 3).deadline).toBe('2026-10-21')
  })

  it('rolls into the next month or year when the date has passed', () => {
    expect(parseQuickAdd('Pay rent by 5', today, 3).deadline).toBe('2026-11-05')
    expect(parseQuickAdd('Plan trip by 2 Jan', today, 3).deadline).toBe('2027-01-02')
    expect(parseQuickAdd('Report by 31', '2026-11-10', 3).deadline).toBe('2026-12-31') // November has no 31st
    expect(parseQuickAdd('Leap by 29 Feb', today, 3).deadline).toBe('2028-02-29')
  })

  it('understands today, tomorrow and weekdays', () => {
    expect(parseQuickAdd('Call mum by today', today, 3).deadline).toBe('2026-10-18')
    expect(parseQuickAdd('Call mum by tomorrow', today, 3).deadline).toBe('2026-10-19')
    expect(parseQuickAdd('Slides by friday', today, 3).deadline).toBe('2026-10-23')
    expect(parseQuickAdd('Slides by Sun', today, 3).deadline).toBe('2026-10-18')
  })

  it('leaves impossible dates in the title', () => {
    expect(parseQuickAdd('Fix by 45', today, 3)).toEqual({ title: 'Fix by 45', deadline: '2026-10-21', explicit: false })
  })

  it('finds dates in free text for mail extraction, without false weekday matches', () => {
    expect(findDateInText('Please submit by Saturday 24 October, 11:59 PM', today)).toBe('2026-10-24')
    expect(findDateInText('could you take a look before Monday?', today)).toBe('2026-10-19')
    expect(findDateInText('This month we monitor the satisfaction survey', today)).toBeNull()
    expect(findDateInText('no date here', today)).toBeNull()
  })
})

describe('reminders', () => {
  const clock = at('2026-10-08', 0.6) // Thursday, 14:24
  const dueToday = task({ id: 'a', startDate: '2026-10-06', deadline: '2026-10-08' })
  const dueTomorrow = task({ id: 'b', startDate: '2026-10-06', deadline: '2026-10-09', subtasks: subs(true, true, true, false) })
  const overdue = task({ id: 'c', startDate: '2026-10-01', deadline: '2026-10-05' })
  const behind = task({ id: 'd', startDate: '2026-10-01', deadline: '2026-10-11', subtasks: subs(true, false, false, false, false, false, false, false, false, false) })
  const starts = task({ id: 'e', startDate: '2026-10-08', deadline: '2026-10-15' })

  it('Smart: due today, due tomorrow, overdue once, behind pace once', () => {
    const kinds = computeReminders([dueToday, dueTomorrow, overdue, behind, starts], 'Smart', clock).map((r) => `${r.taskId}:${r.kind}`)
    expect(kinds).toEqual(['c:overdue', 'a:due-today', 'b:due-tomorrow', 'd:at-risk'])
  })

  it('Minimal (global) caps every task to due-today and overdue', () => {
    const tasks = [dueToday, dueTomorrow, overdue, behind].map((t) => ({ ...t, reminder: 'Frequent' as const }))
    expect(computeReminders(tasks, 'Minimal', clock).map((r) => r.kind)).toEqual(['overdue', 'due-today'])
  })

  it('Frequent adds start-day reminders and repeats daily', () => {
    const t = { ...starts, reminder: 'Frequent' as const }
    expect(remindersFor(t, 'Frequent', clock).map((r) => r.kind)).toEqual(['starts-today'])
    const o = { ...overdue, reminder: 'Frequent' as const }
    expect(remindersFor(o, 'Smart', clock)[0].key).not.toBe(remindersFor(o, 'Smart', at('2026-10-09'))[0].key)
    expect(remindersFor(overdue, 'Smart', clock)[0].key).toBe(remindersFor(overdue, 'Smart', at('2026-10-09'))[0].key)
  })

  it('Evening waits until 6 PM; Weekend only nags at weekends but still says "due today"', () => {
    const evening = { ...dueTomorrow, reminder: 'Evening' as const }
    expect(remindersFor(evening, 'Smart', at('2026-10-08', 0.6))).toEqual([])
    expect(remindersFor(evening, 'Smart', at('2026-10-08', 0.8)).map((r) => r.kind)).toEqual(['due-tomorrow'])
    const weekend = { ...dueTomorrow, reminder: 'Weekend' as const }
    expect(remindersFor(weekend, 'Smart', clock)).toEqual([])
    expect(remindersFor({ ...dueToday, reminder: 'Weekend' }, 'Smart', clock).map((r) => r.kind)).toEqual(['due-today'])
  })

  it('never reminds about completed tasks', () => {
    expect(computeReminders([{ ...overdue, completed: true, completedAt: '2026-10-06T10:00:00Z' }], 'Frequent', clock)).toEqual([])
  })

  it('does not repeat a delivered reminder', () => {
    const all = computeReminders([dueToday, overdue], 'Smart', clock)
    expect(pendingReminders([dueToday, overdue], 'Smart', clock, new Set([all[0].key])).map((r) => r.key)).toEqual([all[1].key])
  })

  it('issues a new reminder when the deadline moves', () => {
    const [before] = remindersFor(dueToday, 'Smart', clock)
    const [after] = remindersFor({ ...dueToday, deadline: '2026-10-09' }, 'Smart', clock)
    expect(after.kind).toBe('due-tomorrow')
    expect(after.key).not.toBe(before.key)
  })
})

describe('work-block planner', () => {
  const clock = at('2026-10-08', 0.5) // noon
  const days = ['2026-10-08', '2026-10-09', '2026-10-10']
  const cn = task({ id: 'cn', priority: 'High', startDate: '2026-10-07', deadline: '2026-10-10', subtasks: subs(true, false) })
  const dbms = task({ id: 'dbms', priority: 'Low', startDate: '2026-10-05', deadline: '2026-10-13' })

  it('places blocks inside working hours for open tasks, earliest deadline first', () => {
    const blocks = planWorkBlocks([dbms, cn], [18, 23], days, clock)
    expect(blocks.map((b) => [b.date, b.taskId, b.from, b.to])).toEqual([
      ['2026-10-08', 'cn', 18, 20.5], ['2026-10-09', 'cn', 18, 20.5], ['2026-10-10', 'cn', 18, 20.5],
    ])
    expect(blocks[0].label).toBe('Step 2')
  })

  it('uses two blocks a day for long working windows and skips past time today', () => {
    const blocks = planWorkBlocks([dbms, cn], [9, 17], ['2026-10-08'], at('2026-10-08', 14.2 / 24))
    expect(blocks.map((b) => [b.taskId, b.from, b.to])).toEqual([['cn', 14.5, 17]])
    expect(planWorkBlocks([dbms, cn], [9, 17], ['2026-10-09'], clock).map((b) => b.taskId)).toEqual(['cn', 'dbms'])
  })

  it('ignores completed or fully-done tasks', () => {
    const done = { ...cn, completed: true, completedAt: '2026-10-08T08:00:00Z' }
    const allSteps = { ...dbms, subtasks: subs(true) }
    expect(planWorkBlocks([done, allSteps], [18, 23], days, clock)).toEqual([])
  })
})

describe('insights from real history', () => {
  const assignment = (id: string, start: string, end: string) => task({ id, title: `Lab report ${id}`, startDate: start, deadline: end })

  it('says nothing without enough samples', () => {
    expect(computeInsights([assignment('a', '2026-10-01', '2026-10-04')], null)).toEqual({ lines: [], assignmentDays: null })
  })

  it('computes the typical assignment window from actual tasks', () => {
    const tasks = [assignment('a', '2026-10-01', '2026-10-04'), assignment('b', '2026-10-01', '2026-10-04'), assignment('c', '2026-10-01', '2026-10-09')]
    expect(computeInsights(tasks, null)).toEqual({ lines: ['You allow about 3 days for assignments.'], assignmentDays: 3 })
  })

  it('ignores history before a reset', () => {
    const tasks = [assignment('a', '2026-10-01', '2026-10-04'), assignment('b', '2026-10-01', '2026-10-04'), assignment('c', '2026-10-01', '2026-10-09')]
    expect(computeInsights(tasks, '2026-10-02T00:00:00.000Z').assignmentDays).toBeNull()
  })

  it('detects evening work and in-order checklists from completion times', () => {
    const evening = (d: number, h: number) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`
    const tasks = [1, 2, 3].map((d) => task({
      id: `t${d}`, completed: true, completedAt: evening(d, 20),
      subtasks: subs(true, true).map((s, i) => ({ ...s, completedAt: evening(d, 18 + i) })),
    }))
    const lines = computeInsights(tasks, null, 'UTC').lines
    expect(lines).toContain('You usually finish work in the evening.')
    expect(lines).toContain('You check off subtasks in order.')
  })
})
