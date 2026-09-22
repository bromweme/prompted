import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotifications } from '../hooks/useNotifications'
import NotificationItem from './NotificationItem'
import './NotificationBell.css'

// The panel shows the newest few; the rest are on the Notifications page.
const PANEL_LIMIT = 3

/**
 * The header bell (NT-1): everything the app wants a player to know without
 * them keeping track themselves: requests answered, kicks and bans, games
 * starting and ending, their turn to judge, rounds opening and closing, host
 * changes. The server keeps the list, so it survives being away, and pushes
 * new items live. Opening the panel marks them read; the ones that were new
 * stay highlighted until it closes.
 */
function NotificationBell() {
  const { items, unreadCount, markRead, remove, clearAll } = useNotifications()
  const [open, setOpen] = useState(false)
  const [newIds, setNewIds] = useState(() => new Set())
  const wrapperRef = useRef(null)
  const buttonRef = useRef(null)

  // Close on a click outside or Escape, returning focus to the bell.
  useEffect(() => {
    if (!open) return
    const onPointer = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setNewIds(new Set(items.filter((n) => !n.read).map((n) => n.id)))
    setOpen(true)
    markRead()
  }

  const handleClearAll = () => {
    if (!confirm('Clear all notifications? This removes them for good.')) return
    clearAll()
  }

  const shown = items.slice(0, PANEL_LIMIT)
  const label = unreadCount > 0
    ? `Notifications, ${unreadCount} unread`
    : 'Notifications'

  return (
    <div className="notification-bell" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="bell-button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label={label}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && (
          <span className="bell-count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div id="notification-panel" className="notification-panel" role="region" aria-label="Notifications">
          <div className="notification-header">
            <h2 className="notification-heading">Notifications</h2>
            {items.length > 0 && (
              <button type="button" className="notification-clear" onClick={handleClearAll}>
                Clear all
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="notification-empty">Nothing yet. Game news will show up here.</p>
          ) : (
            <ul className="notification-list">
              {shown.map((n) => (
                <NotificationItem
                  key={n.id}
                  item={n}
                  isNew={newIds.has(n.id)}
                  onOpen={() => setOpen(false)}
                  onRemove={remove}
                />
              ))}
            </ul>
          )}
          {items.length > PANEL_LIMIT && (
            <Link to="/notifications" className="notification-all" onClick={() => setOpen(false)}>
              See all {items.length} notifications
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationBell
