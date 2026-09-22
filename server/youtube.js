const { youtubeApiKey, youtubeSearchEnabled } = require('./config');
const { decodeHtmlEntities } = require('./htmlEntities');

// YouTube Data API v3 search.
//
// Quota matters here: the default allowance is 10,000 units/day and
// search.list costs 100 units per call — about 100 searches a day for the
// whole server, shared by every player. So results are cached by query and the
// client debounces typing. Without both, a few players typing in the search
// box would exhaust the day's quota in minutes.

const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
// A search costs 100 units per CALL, not per result, so asking for more results
// is free. Eight was too few: searching a band returned their eight most
// relevant videos, and the song you actually meant was often just outside it.
const MAX_RESULTS = 25;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map(); // normalized query -> { at, results }

function normalizeQuery(query) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the map evicts least-recently-used.
  cache.delete(key);
  cache.set(key, hit);
  return hit.results;
}

function writeCache(key, results) {
  cache.set(key, { at: Date.now(), results });
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

// Stands in for the API until a key exists, so the search UI and the e2e suite
// are developable and testable offline and without spending quota.
const FIXTURES = [
  { videoId: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', channelTitle: 'Rick Astley' },
  { videoId: '9bZkp7q19f0', title: 'PSY - GANGNAM STYLE', channelTitle: 'officialpsy' },
  { videoId: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito ft. Daddy Yankee', channelTitle: 'Luis Fonsi' },
  { videoId: 'fJ9rUzIMcZQ', title: 'Queen - Bohemian Rhapsody', channelTitle: 'Queen Official' },
  { videoId: 'YQHsXMglC9A', title: 'Adele - Hello', channelTitle: 'Adele' },
  { videoId: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', channelTitle: 'Ed Sheeran' },
  { videoId: 'CevxZvSJLk8', title: 'Katy Perry - Roar', channelTitle: 'Katy Perry' },
  { videoId: 'RgKAFK5djSk', title: 'Wiz Khalifa - See You Again ft. Charlie Puth', channelTitle: 'Wiz Khalifa' },
  // Written HTML-escaped on purpose: this is the exact shape the real API
  // sends, so the fixture path exercises decoding rather than hiding it.
  {
    videoId: 'L_jWHffIx5E',
    title: 'Smash Mouth - &quot;All Star&quot; (Steve&#39;s Remix) &amp; More',
    channelTitle: 'Smash Mouth &amp; Friends'
  }
];

// Decoded once at module load, mirroring what searchVideos does at the API
// boundary — so both paths hand the client the same already-clean text, and
// a search matches what the player can actually see.
const DECODED_FIXTURES = FIXTURES.map(v => ({
  ...v,
  title: decodeHtmlEntities(v.title),
  channelTitle: decodeHtmlEntities(v.channelTitle)
}));

function thumbnailFor(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

// Every shape a player might paste: a watch link, a share link, a Shorts or
// embed link, a music.youtube link, or the bare id. Search can't find every
// song — the exact one someone means is often outside any result list — so a
// link is the way to say "this one, precisely".
const URL_PATTERNS = [
  /[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/,          // youtube.com/watch?v=ID
  /youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/,   // youtu.be/ID
  /\/shorts\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/,    // youtube.com/shorts/ID
  /\/embed\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/,     // youtube.com/embed/ID
  /\/live\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/       // youtube.com/live/ID
];

/** The video id in a pasted link or bare id, or null if this is a plain search. */
function extractVideoId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (isValidVideoId(text)) return text;
  if (!/youtu\.?be/i.test(text)) return null;
  for (const pattern of URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * What the server itself knows about a video, or null when it has no way to
 * know. Used to check a submission's title and channel rather than taking the
 * client's word for them: a crafted client can send any videoId with any
 * title, which is how a video gets mislabelled for everybody else.
 *
 * Returns null when no API key is configured — offline there is no authority
 * to check against, and inventing one would be worse than admitting it. The
 * caller keeps the client's values in that case.
 *
 * Normally free: search results are cached by id as they are returned, so a
 * video the player actually picked in the app is already here.
 */
async function describeVideo(videoId) {
  if (!isValidVideoId(videoId) || !youtubeSearchEnabled) return null;
  const cached = readCache(`id:${videoId}`);
  if (cached) return cached[0] || null;
  const video = await lookupVideo(videoId);
  writeCache(`id:${videoId}`, video ? [video] : []);
  return video;
}

/**
 * One video by id. videos.list costs 1 quota unit against search.list's 100,
 * so a pasted link is a hundred times cheaper than a search — worth preferring
 * wherever a player already knows exactly what they want.
 */
async function lookupVideo(videoId) {
  if (!youtubeSearchEnabled) {
    // Offline and in tests: the id is real even when the metadata isn't, so
    // the pick-and-submit flow still works without spending any quota.
    const known = DECODED_FIXTURES.find(v => v.videoId === videoId);
    if (known) return { ...known, thumbnail: thumbnailFor(known.videoId) };
    return { videoId, title: `YouTube video ${videoId}`, channelTitle: 'YouTube', thumbnail: thumbnailFor(videoId) };
  }

  const url = new URL(VIDEOS_ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', youtubeApiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`YouTube lookup failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const item = (data.items || [])[0];
  // A link to a deleted or private video resolves to nothing, which the caller
  // reports as "no results" rather than as an error.
  if (!item || !item.snippet) return null;
  return {
    videoId,
    title: decodeHtmlEntities(item.snippet.title || ''),
    channelTitle: decodeHtmlEntities(item.snippet.channelTitle || ''),
    thumbnail: thumbnailFor(videoId)
  };
}

function searchFixtures(query) {
  const q = normalizeQuery(query);
  const matches = DECODED_FIXTURES.filter(
    v => v.title.toLowerCase().includes(q) || v.channelTitle.toLowerCase().includes(q)
  );
  // An unmatched query still returns something, so the picker UI is always
  // exercisable regardless of what gets typed.
  const chosen = matches.length > 0 ? matches : DECODED_FIXTURES;
  return chosen.slice(0, MAX_RESULTS).map(v => ({ ...v, thumbnail: thumbnailFor(v.videoId) }));
}

/**
 * Returns up to MAX_RESULTS videos as { videoId, title, thumbnail, channelTitle }.
 * Falls back to fixtures when no API key is configured; throws only when a
 * configured key actually fails, so a real outage is visible rather than being
 * silently papered over with fixture data.
 */
async function searchVideos(query) {
  const key = normalizeQuery(query);
  if (!key) return [];

  // A pasted link resolves to exactly that video instead of being searched for
  // as text, which would find nothing.
  const pastedId = extractVideoId(query);
  if (pastedId) {
    const cachedVideo = readCache(`id:${pastedId}`);
    if (cachedVideo) return cachedVideo;
    const video = await lookupVideo(pastedId);
    const results = video ? [video] : [];
    writeCache(`id:${pastedId}`, results);
    return results;
  }

  const cached = readCache(key);
  if (cached) return cached;

  if (!youtubeSearchEnabled) {
    const results = searchFixtures(query);
    writeCache(key, results);
    return results;
  }

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  // No videoEmbeddable filter. It used to be set so the reveal's iframe could
  // never fail, but it hid a lot of real music — plenty of official uploads are
  // embed-restricted — and a search that can't find the song you meant is the
  // worse failure. The reveal now offers a "Watch on YouTube" link alongside
  // the player, so a video that refuses to embed is still reachable.
  url.searchParams.set('maxResults', String(MAX_RESULTS));
  url.searchParams.set('q', query);
  url.searchParams.set('key', youtubeApiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // The key never appears in the thrown message; body can echo the request.
    throw new Error(`YouTube search failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const results = (data.items || [])
    .filter(item => item.id && item.id.videoId)
    .map(item => ({
      videoId: item.id.videoId,
      // The API returns snippet text HTML-escaped. Decoded here, at the
      // boundary, and therefore before writeCache below — so it happens once
      // per unique result rather than on every render, and every consumer
      // (search list, submission, round history) sees the same clean text.
      title: decodeHtmlEntities(item.snippet.title),
      channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
      thumbnail:
        (item.snippet.thumbnails && item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url) ||
        thumbnailFor(item.id.videoId)
    }));

  writeCache(key, results);
  // Also keyed by id, so checking a submission against what the server knows
  // (describeVideo) costs nothing for any video a player actually saw here.
  for (const video of results) writeCache(`id:${video.videoId}`, [video]);
  return results;
}

// YouTube ids are exactly 11 chars of [A-Za-z0-9_-]. Validating the shape lets
// the id be dropped straight into an embed URL without becoming an injection
// point in the iframe src.
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function isValidVideoId(value) {
  return typeof value === 'string' && VIDEO_ID_PATTERN.test(value);
}

module.exports = { searchVideos, describeVideo, isValidVideoId, extractVideoId, thumbnailFor, MAX_RESULTS };
