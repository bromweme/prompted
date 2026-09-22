// Unit tests for pasted-link handling. Run with `npm test`.
//
// A player who knows exactly which video they want should be able to say so.
// Search can't always find it — the right one is often outside any result
// list — and resolving a link costs 1 quota unit against search's 100.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractVideoId, isValidVideoId, MAX_RESULTS } = require('../youtube');

test('every shape a player might paste resolves to the same id', () => {
  const id = 'dQw4w9WgXcQ';
  const links = [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `http://youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&list=RDAMVM123`,
    `https://www.youtube.com/watch?v=${id}&t=42s`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `  https://www.youtube.com/watch?v=${id}  `
  ];
  for (const link of links) {
    assert.equal(extractVideoId(link), id, link);
  }
});

test('ordinary searches are not mistaken for links', () => {
  // Including a band whose name is exactly 11 characters, which is what a bare
  // video id looks like — the id alphabet is the guard, not the length alone.
  for (const query of ['Metallica', 'love', 'the beatles', 'Rage Against', '', null, undefined]) {
    assert.equal(extractVideoId(query), null, String(query));
  }
});

test('a link to something that is not a video id resolves to nothing', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=tooshort',
    'https://www.youtube.com/watch?v=way-too-long-to-be-an-id',
    'https://www.youtube.com/results?search_query=queen',
    'https://example.com/watch?v=dQw4w9WgXcQ'
  ]) {
    assert.equal(extractVideoId(link), null, link);
  }
});

test('ids keep their case', () => {
  // Video ids are case-sensitive, so anything that lowercases on the way
  // through would resolve to a different video or to nothing at all.
  const mixed = 'L_jWHffIx5E';
  assert.equal(extractVideoId(`https://youtu.be/${mixed}`), mixed);
  assert.ok(isValidVideoId(mixed));
});

test('a search asks for more than a handful of results', () => {
  // The quota cost is per call, not per result, so a small cap bought nothing
  // and hid the song people were looking for.
  assert.ok(MAX_RESULTS >= 20, `expected a generous result count, got ${MAX_RESULTS}`);
});
