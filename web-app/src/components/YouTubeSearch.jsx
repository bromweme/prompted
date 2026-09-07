import { useEffect, useRef, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import './YouTubeSearch.css'

// Typing fires one search per pause, not per keystroke. YouTube's search.list
// costs 100 of the 10,000 daily quota units per call, so an un-debounced box
// would burn the whole day's allowance in a couple of minutes of typing.
const DEBOUNCE_MS = 450

function YouTubeSearch({ selected, onSelect }) {
  const { socket, isConnected } = useSocket()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  // The query the newest response should correspond to. Responses that don't
  // match it are stale and get dropped, so a slow earlier search can't
  // overwrite the results of a later one.
  const pendingQuery = useRef('')

  useEffect(() => {
    if (!socket) return undefined

    const handleResults = ({ query: forQuery, results: items }) => {
      if (forQuery !== pendingQuery.current) return
      setResults(items || [])
      setIsSearching(false)
    }

    const handleError = ({ message }) => {
      if (!pendingQuery.current) return
      setSearchError(message)
      setIsSearching(false)
    }

    socket.on('youtube_results', handleResults)
    socket.on('error', handleError)

    return () => {
      socket.off('youtube_results', handleResults)
      socket.off('error', handleError)
    }
  }, [socket])

  useEffect(() => {
    const trimmed = query.trim()

    if (!trimmed || !socket || !isConnected) {
      setResults([])
      setIsSearching(false)
      pendingQuery.current = ''
      return undefined
    }

    setIsSearching(true)
    setSearchError(null)

    const timer = setTimeout(() => {
      // The server normalises the query before echoing it back, so match that
      // here or every response would look stale.
      pendingQuery.current = trimmed.toLowerCase().replace(/\s+/g, ' ')
      socket.emit('search_youtube', { query: trimmed })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, socket, isConnected])

  return (
    <div className="youtube-search">
      <div className="form-group">
        <label htmlFor="video-search">Search for a video *</label>
        <input
          id="video-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Song, artist, or anything else"
          maxLength={120}
          autoComplete="off"
        />
        <small className="form-hint">Pick a result below — that video is what everyone will watch.</small>
      </div>

      <div aria-live="polite" className="youtube-search-status">
        {isSearching && <span>Searching…</span>}
        {searchError && <span className="youtube-search-error">{searchError}</span>}
        {!isSearching && !searchError && query.trim() && results.length === 0 && (
          <span>No videos found.</span>
        )}
      </div>

      {results.length > 0 && (
        <ul className="youtube-results" aria-label="Video search results">
          {results.map((video) => {
            const isSelected = selected && selected.videoId === video.videoId
            return (
              <li key={video.videoId}>
                <button
                  type="button"
                  className={`youtube-result ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelect(video)}
                  aria-pressed={isSelected}
                >
                  <img
                    className="youtube-result-thumb"
                    src={video.thumbnail}
                    alt=""
                    width="120"
                    height="68"
                    loading="lazy"
                  />
                  <span className="youtube-result-meta">
                    <span className="youtube-result-title">{video.title}</span>
                    <span className="youtube-result-channel">{video.channelTitle}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default YouTubeSearch
