import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppNav from '../components/AppNav'
import NotificationItem from '../components/NotificationItem'
import { useNotifications } from '../hooks/useNotifications'
import '../components/NotificationBell.css'
import './Notifications.css'

// Every notification (NT-1), for when the bell's short list isn't enough.
// Opening the page counts as seeing them, the same as opening the bell.
function Notifications() {
  const { items, unreadCount, loaded, markRead, remove, clearAll } = useNotifications()
  const [newIds, setNewIds] = useState(null)

  // Remember which were new on arrival (so they stay highlighted), then mark
  // them read on the server.
  if (loaded && newIds === null) {
    setNewIds(new Set(items.filter((n) => !n.read).map((n) => n.id)))
  }
  useEffect(() => {
    if (newIds !== null && unreadCount > 0) markRead()
  }, [newIds, unreadCount, markRead])

  const handleClearAll = () => {
    if (!confirm('Clear all notifications? This removes them for good.')) return
    clearAll()
  }

  return (
    <div className="notifications-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <AppNav />

      <main id="main-content" className="notifications-main">
        <div className="notifications-content">
          <Link to="/dashboard" className="notifications-back">← Back to dashboard</Link>
          <div className="notifications-title-row">
            <h1>Notifications</h1>
            {items.length > 0 && (
              <button type="button" className="cancel-button" onClick={handleClearAll}>
                Clear all
              </button>
            )}
          </div>

          {loaded && items.length === 0 && (
            <p className="notification-empty">Nothing yet. Game news will show up here.</p>
          )}

          {items.length > 0 && (
            <ul className="notification-list notifications-page-list">
              {items.map((n) => (
                <NotificationItem key={n.id} item={n} isNew={!!newIds?.has(n.id)} onRemove={remove} />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}

export default Notifications
