import './RoundVideoList.css'

// YouTube's multi-video watch URL plays a set of videos back-to-back as a
// temporary, unsaved playlist. It is just a link — no API call, no OAuth
// scope, and nothing written to anyone's account. That is precisely why it is
// used here instead of the Playlists API, which would require the
// youtube.force-ssl scope on top of the sign-in scopes this app requests.
const WATCH_ALL_BASE = 'https://www.youtube.com/watch_videos?video_ids='

// YouTube caps the ids this URL accepts; past that it silently drops the tail,
// so the list is truncated deliberately and the UI says so.
const MAX_WATCH_ALL = 50

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

export function buildWatchAllUrl(videos) {
  const ids = (videos || [])
    .map((v) => v && v.videoId)
    .filter((id) => VIDEO_ID_PATTERN.test(id || ''))
    .slice(0, MAX_WATCH_ALL)

  return ids.length > 0 ? `${WATCH_ALL_BASE}${ids.join(',')}` : null
}

/**
 * The round's videos, with a link that plays all of them in sequence on
 * YouTube. Shown once every submission is in — during voting, at the reveal,
 * and afterwards in history.
 */
function RoundVideoList({ videos, heading = "This round's videos" }) {
  const items = (videos || []).filter((v) => v && VIDEO_ID_PATTERN.test(v.videoId || ''))
  if (items.length === 0) return null

  const watchAllUrl = buildWatchAllUrl(items)

  return (
    <section className="round-video-list" aria-label={heading}>
      <div className="round-video-list-header">
        <h4>{heading}</h4>
        {watchAllUrl && (
          <a
            className="watch-all-link"
            href={watchAllUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            ▶ Watch all on YouTube
          </a>
        )}
      </div>

      <ul className="round-video-items">
        {/* Two players can legitimately submit the same video, so the id
            alone is not a unique key. */}
        {items.map((video, index) => (
          <li key={`${video.videoId}-${index}`} className="round-video-item">
            <img
              className="round-video-thumb"
              src={video.thumbnail}
              alt=""
              width="96"
              height="54"
              loading="lazy"
            />
            <span className="round-video-meta">
              <span className="round-video-title">{video.title}</span>
              <span className="round-video-channel">{video.channelTitle}</span>
            </span>
          </li>
        ))}
      </ul>

      {items.length > MAX_WATCH_ALL && (
        <p className="round-video-note">
          The watch-all link covers the first {MAX_WATCH_ALL} videos.
        </p>
      )}
    </section>
  )
}

export default RoundVideoList
