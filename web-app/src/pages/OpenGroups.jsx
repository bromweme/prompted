import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppNav from '../components/AppNav'
import OpenGroupCard from '../components/OpenGroupCard'
import { useOpenGroups } from '../hooks/useOpenGroups'
import './OpenGroups.css'

// Searching waits until typing pauses: every request draws from the same
// per-socket rate limit as the player's real actions.
const SEARCH_DEBOUNCE_MS = 300

// 48 is also the server's cap on one page.
const PAGE_SIZES = [12, 24, 48]
const DEFAULT_PAGE_SIZE = 12

// Page numbers to show: all of them when there are few, otherwise the first,
// the last, and the current page's neighbours, with gaps marked.
function pageItems(current, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const items = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(totalPages - 1, current + 1)
  if (start > 2) items.push('gap-start')
  for (let n = start; n <= end; n++) items.push(n)
  if (end < totalPages - 1) items.push('gap-end')
  items.push(totalPages)
  return items
}

// Writes the given keys into the search params, dropping any that are empty
// or at their default so the URL stays clean (?q=jazz, not ?q=jazz&page=1).
function withParams(prev, updates) {
  const next = new URLSearchParams(prev)
  for (const [key, value] of Object.entries(updates)) {
    const isDefault = value === null || value === '' ||
      (key === 'page' && value === 1) || (key === 'size' && value === DEFAULT_PAGE_SIZE)
    if (isDefault) next.delete(key)
    else next.set(key, String(value))
  }
  return next
}

// Open groups search (OG-1). The search, page size, and page all live in the
// URL (?q=&size=&page=) so a refresh, a shared link, or the Back button keep
// them. The server does the matching and paging, across every open group.
function OpenGroups() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q') || ''
  const requestedSize = Number(searchParams.get('size'))
  const pageSize = PAGE_SIZES.includes(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE
  const page = Math.max(Math.floor(Number(searchParams.get('page'))) || 1, 1)

  const [input, setInput] = useState(urlQuery)
  const [syncedQuery, setSyncedQuery] = useState(urlQuery)
  // The query this page last saved to the URL itself.
  const [savedQuery, setSavedQuery] = useState(null)
  const resultsTop = useRef(null)

  // Back/forward can change the URL without any typing, so the box follows
  // it. The URL also changes when our own debounce saves the input, and that
  // echo must never be copied back into the box: React Router applies URL
  // updates at low priority, so on a slow device the echo of an earlier
  // pause can land after the player has typed more, and copying it would
  // throw their newer text away (it also would eat a trailing space).
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery)
    if (urlQuery !== savedQuery && urlQuery !== input.trim()) setInput(urlQuery)
  }

  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === urlQuery) return
    const timer = setTimeout(() => {
      // A new search starts from page 1. replace: each typing pause
      // shouldn't become its own Back step.
      setSavedQuery(trimmed)
      setSearchParams((prev) => withParams(prev, { q: trimmed, page: 1 }), { replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input, urlQuery, setSearchParams])

  const { groups, total, loaded } = useOpenGroups({
    query: urlQuery,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })

  const totalPages = Math.max(Math.ceil(total / pageSize), 1)

  // Groups can start or close while someone is on a late page; if the list
  // shrinks underneath them, land them on the last page that still exists.
  useEffect(() => {
    if (loaded && total > 0 && page > totalPages) {
      setSearchParams((prev) => withParams(prev, { page: totalPages }), { replace: true })
    }
  }, [loaded, total, page, totalPages, setSearchParams])

  // Page changes are real navigation steps, so Back walks back through pages.
  const goToPage = (target) => {
    setSearchParams((prev) => withParams(prev, { page: target }))
    resultsTop.current?.scrollIntoView({ block: 'start' })
  }

  const changePageSize = (size) => {
    setSearchParams((prev) => withParams(prev, { size, page: 1 }))
  }

  let status = ''
  if (loaded && total > 0) {
    const from = (page - 1) * pageSize + 1
    const to = from + groups.length - 1
    const range = from === to ? `${from}` : `${from}–${to}`
    const what = urlQuery ? `groups matching "${urlQuery}"` : 'open groups'
    status = `Showing ${range} of ${total} ${what}`
  }

  return (
    <div className="open-groups-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <AppNav />

      <main id="main-content" className="open-groups-main">
        <div className="open-groups-content">
          <Link to="/dashboard" className="open-groups-back">← Back to dashboard</Link>
          <h1>Open Groups</h1>
          <p className="open-groups-page-intro">
            Groups anyone can ask to join. They stay listed until their first round starts.
          </p>

          <div className="open-groups-controls">
            <form className="form-group open-groups-search" role="search" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor="open-groups-query">Search open groups</label>
              <input
                id="open-groups-query"
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Group name, description, or host"
                maxLength={100}
                autoComplete="off"
                aria-describedby="open-groups-status"
              />
            </form>

            <div className="form-group open-groups-size">
              <label htmlFor="open-groups-size">Groups per page</label>
              <select
                id="open-groups-size"
                value={pageSize}
                onChange={(e) => changePageSize(Number(e.target.value))}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>

          <p id="open-groups-status" ref={resultsTop} className="open-groups-status" role="status">{status}</p>

          {loaded && groups.length > 0 && (
            <ul className="groups-grid open-groups-results">
              {groups.map((group) => (
                <OpenGroupCard key={group.id} group={group} />
              ))}
            </ul>
          )}

          {loaded && total === 0 && (
            <div className="empty-state">
              <h2>{urlQuery ? 'No matching groups' : 'No open groups right now'}</h2>
              <p>
                {urlQuery
                  ? 'Try a different word, or check back later.'
                  : 'Groups that aren\'t private show up here until they start.'}
              </p>
            </div>
          )}

          {loaded && totalPages > 1 && (
            <nav className="open-groups-pagination" aria-label="Pagination">
              <button
                type="button"
                className="page-button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
              >
                Previous
              </button>

              <ul className="page-list">
                {pageItems(page, totalPages).map((item) => (
                  typeof item === 'number' ? (
                    <li key={item}>
                      <button
                        type="button"
                        className={`page-button page-number${item === page ? ' current' : ''}`}
                        onClick={() => goToPage(item)}
                        aria-current={item === page ? 'page' : undefined}
                        aria-label={`Page ${item}`}
                      >
                        {item}
                      </button>
                    </li>
                  ) : (
                    <li key={item} className="page-gap" aria-hidden="true">…</li>
                  )
                ))}
              </ul>

              <button
                type="button"
                className="page-button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </nav>
          )}
        </div>
      </main>
    </div>
  )
}

export default OpenGroups
