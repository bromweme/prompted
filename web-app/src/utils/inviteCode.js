// Invite-code helpers shared by the Dashboard "Join Group" form, the /join/:code
// route and the Invite modal (UI-2).
//
// Mirrors server/invites.js: a code is 20 letters A-Z, displayed in groups of
// five (ABCDE-FGHIJ-KLMNO-PQRST). Input is compared after upper-casing and
// removing whitespace and dashes, never anything else, because a pre-UI-2
// group's code is its id (GROUP<digits>_<n>) and must survive normalisation.

const MODERN_CODE = /^[A-Z]{20}$/

export function normalizeInviteCode(input) {
  if (typeof input !== 'string') return ''
  return input.replace(/[\s-]+/g, '').toUpperCase()
}

// Grouped for reading aloud or typing. Legacy codes are shown exactly as they
// are, since grouping a GROUP… id would only make it harder to recognise.
export function formatInviteCode(code) {
  const normalized = normalizeInviteCode(code)
  if (!MODERN_CODE.test(normalized)) return code || ''
  return normalized.match(/.{5}/g).join('-')
}

// The shareable link: a clean path, no query string. The code is sent
// normalised (no dashes) so the URL stays as short as it can be.
export function inviteLinkFor(code, origin = window.location.origin) {
  return `${origin}/join/${encodeURIComponent(normalizeInviteCode(code))}`
}
