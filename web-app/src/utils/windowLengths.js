// Round-window length model shared by the Create Group wizard, the Rules editor
// (GroupView) and the Dashboard.
//
// Each round has a submission window and a voting window, and the host sets
// each as a numeric value + a unit (minutes / hours / days). The persisted
// settings fields — `submissionTime` / `votingTime` — remain hours; this module
// is the single place that maps between the value+unit the host edits and the
// hours that get sent to the server.
//
// The server clamps the received hours to a sensible band (see
// server/server.js clampWindowHours). On the client we clamp the *value* per
// unit up front so the numbers shown stay in range: the ceiling is always 168
// hours, which is 10080 minutes or 7 days.
export const WINDOW_UNITS = ['minutes', 'hours', 'days']

// Per-unit bounds for the numeric value (in the chosen unit).
export const WINDOW_VALUE_BOUNDS = {
  minutes: { min: 1, max: 10080 }, // 10080 minutes == 168 hours
  hours: { min: 1, max: 168 },
  days: { min: 1, max: 7 } // 7 days == 168 hours
}

const UNIT_HOURS = { minutes: 1 / 60, hours: 1, days: 24 }

// Clamps a raw numeric value to the chosen unit's bounds, returning an integer
// (the controls only ever edit whole numbers). Falls back to the hours bounds
// when the unit is unknown.
export function clampWindowValue(value, unit) {
  const bounds = WINDOW_VALUE_BOUNDS[unit] || WINDOW_VALUE_BOUNDS.hours
  const v = Math.round(Number(value))
  if (!Number.isFinite(v)) return bounds.min
  return Math.min(bounds.max, Math.max(bounds.min, v))
}

// Converts a value+unit the host edited into the hours the settings store.
export function windowValueToHours(value, unit) {
  return clampWindowValue(value, unit) * (UNIT_HOURS[unit] || 1)
}

// Presents stored hours back as a value+unit for the edit form. Prefers the
// most natural unit so a whole number of days shows as days and a sub-hour
// window shows as minutes; otherwise hours.
export function hoursToWindowValue(hours) {
  const h = Number(hours)
  if (!Number.isFinite(h) || h <= 0) return { value: 24, unit: 'hours' }

  if (h < 1) {
    return { value: clampWindowValue(Math.round(h * 60), 'minutes'), unit: 'minutes' }
  }
  if (h % 24 === 0 && h / 24 >= 1 && h / 24 <= 7) {
    return { value: h / 24, unit: 'days' }
  }
  return { value: clampWindowValue(Math.round(h), 'hours'), unit: 'hours' }
}