// The bounds and choices for group settings, defined once.
//
// There are two forms that set these — the Create Group wizard and the Edit
// Rules panel — and they had drifted apart, each holding its own copy of every
// limit. The wizard offered at most 20 players, Edit Rules accepted 50. The
// wizard capped jury points at 5, Edit Rules at 10. The wizard chose rounds
// from a list, Edit Rules took any number to 20. A host could therefore set a
// value through one form that the other would have refused, and `maxPlayers`
// was not enforced anywhere at all, so the number was decorative either way.
//
// Every limit here is mirrored by a clamp in server.js, because a form is a
// convenience and not a control: the server never trusts these values. The
// rule between the two is that the server's range must be at least as wide as
// what the form offers. A form that offers a value the server will refuse is
// how you get a control that silently does something other than what it says
// — which `downvoteCost` did, offering 0 while the server forced 1.

// Selects, where a short list of sensible values beats a free number box.
export const TOTAL_ROUNDS_CHOICES = [4, 6, 8, 10, 12];
export const MAX_PLAYER_CHOICES = [4, 6, 8, 12, 16, 20];

// Numeric fields: [min, max], matching clampers of the same name server-side.
export const CZAR_POINTS_RANGE = [1, 10];
// 1-10 rather than the wizard's old 1-5: Edit Rules already allowed up to 10,
// so groups may be stored with 6-10. Narrowing the range would make a stored
// value unrepresentable in the form that is supposed to edit it.
export const MAX_JURY_POINTS_RANGE = [1, 10];
export const VOTE_BUDGET_RANGE = [1, 100];
// Minimum 1, not 0. A downvote must always spend budget (RT-2-1) and the
// server clamps a 0 up to 1, so offering 0 was offering something that could
// not happen.
export const DOWNVOTE_COST_RANGE = [1, 5];
export const OVERRIDE_THRESHOLD_RANGE = [51, 100];

// Spread onto an <input type="number"> so the bound and the attribute cannot
// disagree: numberBounds(VOTE_BUDGET_RANGE) -> { min: 1, max: 100 }.
export function numberBounds([min, max]) {
  return { min, max };
}
