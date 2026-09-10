import { test, expect } from '@playwright/test'
import { windowValueToHours, hoursToWindowValue } from '../src/utils/windowLengths.js'

// REP-RT1-1: a minute window that isn't a whole hour used to round-trip up to a
// larger whole hour. hoursToWindowValue(1.5) (i.e. a 90-minute window) returned
// { value: 2, unit: 'hours' }, and re-saving grew a 90-minute window to 120
// minutes. The fix represents any non-whole-hour window in whole minutes so
// that feeding the result back through windowValueToHours reproduces the exact
// stored hours, for every value the edit controls can produce.
//
// This drives the pure windowLengths module directly (it has no browser or
// React dependencies), which is a focused unit-style check for the round-trip
// invariant without the cost of driving the Create Group / Rules UI.
test.describe('windowLengths round-trip', () => {
  test('hoursToWindowValue round-trips back to the exact stored hours', () => {
    // The regressing cases: sub-hour-but-multi-hour windows must be shown as
    // minutes, not rounded up to a larger whole hour.
    for (const hours of [1.5, 2.5, 3.5, 4.5, 100.5]) {
      const roundTripped = windowValueToHours(
        hoursToWindowValue(hours).value,
        hoursToWindowValue(hours).unit
      )
      expect(roundTripped, `${hours}h must round-trip exactly`).toBe(hours)
    }

    // 90 / 150 / 210 minute windows are the concrete cases from the issue.
    const cases = {
      90: 1.5, // 90 min -> 1.5 hours
      150: 2.5, // 150 min -> 2.5 hours
      210: 3.5 // 210 min -> 3.5 hours
    }
    for (const [minutes, hours] of Object.entries(cases)) {
      const presented = hoursToWindowValue(hours)
      expect(presented).toEqual({ value: Number(minutes), unit: 'minutes' })
      expect(windowValueToHours(presented.value, presented.unit)).toBe(hours)
    }

    // Whole numbers of hours stay shown as hours and round-trip exactly.
    for (const hours of [1, 2, 5, 24, 48]) {
      const shown = hoursToWindowValue(hours)
      expect(windowValueToHours(shown.value, shown.unit), `${hours}h must round-trip exactly`).toBe(hours)
      // 24h / 48h are whole-day values and should present as days.
      if (hours % 24 === 0) {
        expect(shown.unit).toBe('days')
      } else {
        expect(shown).toEqual({ value: hours, unit: 'hours' })
      }
    }

    // A sub-hour window stays in minutes and round-trips exactly.
    expect(hoursToWindowValue(0.5)).toEqual({ value: 30, unit: 'minutes' })
    expect(windowValueToHours(hoursToWindowValue(0.5).value, hoursToWindowValue(0.5).unit)).toBe(0.5)

    // Whole-day windows stay in days and round-trip exactly.
    for (const days of [1, 2, 7]) {
      expect(hoursToWindowValue(days * 24)).toEqual({ value: days, unit: 'days' })
      expect(windowValueToHours(hoursToWindowValue(days * 24).value, hoursToWindowValue(days * 24).unit))
        .toBe(days * 24)
    }
  })

  test('a non-whole-hour window is shown in minutes, never rounded up', () => {
    expect(hoursToWindowValue(1.5)).toEqual({ value: 90, unit: 'minutes' })
    expect(hoursToWindowValue(2.5)).toEqual({ value: 150, unit: 'minutes' })
    expect(hoursToWindowValue(3.5)).toEqual({ value: 210, unit: 'minutes' })
  })
})