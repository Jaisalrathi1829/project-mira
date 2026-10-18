import { describe, expect, it } from 'vitest'
import { addDays, clockAt, dayOfWeek, diffDays, isISODate, isWeekend, localDateOf, rangeLabel, shortDate } from '../../shared/dates'

describe('calendar dates', () => {
  it('validates YYYY-MM-DD including leap years', () => {
    expect(isISODate('2026-10-08')).toBe(true)
    expect(isISODate('2028-02-29')).toBe(true)
    expect(isISODate('2027-02-29')).toBe(false)
    expect(isISODate('2100-02-29')).toBe(false)
    expect(isISODate('2000-02-29')).toBe(true)
    expect(isISODate('2026-13-01')).toBe(false)
    expect(isISODate('2026-04-31')).toBe(false)
    expect(isISODate('2026-1-1')).toBe(false)
    expect(isISODate('2026-10-08T00:00')).toBe(false)
    expect(isISODate(20261008)).toBe(false)
  })

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('counts calendar days the same on both sides of a DST change', () => {
    // US clocks change on 8 March and 1 November 2026; Europe on 29 March and 25 October.
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2)
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2)
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2)
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(diffDays('2026-10-10', '2026-10-07')).toBe(-3)
  })

  it('knows weekdays and weekends independent of the runtime time zone', () => {
    expect(dayOfWeek('2026-10-08')).toBe(4) // Thursday
    expect(isWeekend('2026-10-10')).toBe(true)
    expect(isWeekend('2026-10-12')).toBe(false)
  })
})

describe('clock: today in a time zone', () => {
  it('rolls over exactly at local midnight', () => {
    expect(clockAt(new Date('2026-10-18T18:29:59Z'), 'Asia/Kolkata').today).toBe('2026-10-18')
    const after = clockAt(new Date('2026-10-18T18:30:00Z'), 'Asia/Kolkata')
    expect(after.today).toBe('2026-10-19')
    expect(after.dayFraction).toBe(0)
    expect(after.hour).toBe(0)
  })

  it('gives different calendar days for the same instant in different zones', () => {
    const instant = new Date('2026-10-18T11:30:00Z')
    expect(localDateOf(instant, 'Pacific/Auckland')).toBe('2026-10-19')
    expect(localDateOf(instant, 'America/Los_Angeles')).toBe('2026-10-18')
    expect(localDateOf(instant, 'UTC')).toBe('2026-10-18')
  })

  it('reports wall-clock time correctly across DST transitions', () => {
    const before = clockAt(new Date('2026-03-08T06:59:59Z'), 'America/New_York')
    const after = clockAt(new Date('2026-03-08T07:00:00Z'), 'America/New_York')
    expect(before.today).toBe('2026-03-08')
    expect(Math.floor(before.hour)).toBe(1)
    expect(after.today).toBe('2026-03-08')
    expect(after.hour).toBe(3)
    expect(clockAt(new Date('2026-11-01T05:30:00Z'), 'America/New_York').hour).toBe(1.5) // first 1:30 AM (EDT)
    expect(clockAt(new Date('2026-11-01T06:30:00Z'), 'America/New_York').hour).toBe(1.5) // second 1:30 AM (EST)
  })
})

describe('display formatting', () => {
  it('formats short dates and appends the year only when it differs', () => {
    expect(shortDate('2026-10-08', 2026)).toMatch(/^8 \S+$/)
    expect(shortDate('2027-01-03', 2026)).toMatch(/^3 \S+ 2027$/)
  })

  it('labels ranges within and across months and years', () => {
    expect(rangeLabel('2026-10-04', '2026-10-17')).toMatch(/^4 – 17 \S+$/)
    expect(rangeLabel('2026-10-28', '2026-11-10')).toMatch(/^28 \S+ – 10 \S+$/)
    expect(rangeLabel('2026-12-28', '2027-01-10')).toMatch(/2027$/)
  })
})
