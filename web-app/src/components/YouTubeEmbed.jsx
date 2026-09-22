import './YouTubeEmbed.css'

// YouTube ids are exactly 11 characters of [A-Za-z0-9_-]. The id goes straight
// into the iframe src, so it is re-checked here as well as on the server —
// a client-side render should never be the only thing standing between a
// stored value and a URL.
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

function YouTubeEmbed({ videoId, title }) {
  if (!VIDEO_ID_PATTERN.test(videoId || '')) {
    return <p className="youtube-embed-error">This video can no longer be played.</p>
  }

  return (
    <div className="youtube-embed">
      <div className="youtube-embed-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title={title ? `${title} — YouTube video player` : 'YouTube video player'}
          loading="lazy"
          // Deliberately narrow: enough for playback and fullscreen, nothing
          // that would let an embedded page reach the camera, mic or location.
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {/* Search no longer hides embed-restricted videos, so the player can say
          "Video unavailable" for a perfectly good song. A page can't reliably
          detect that from outside the iframe, so the way out is always offered
          rather than shown only on failure. */}
      <p className="youtube-embed-fallback">
        Player not working?{' '}
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch on YouTube
        </a>
      </p>
    </div>
  )
}

export default YouTubeEmbed
