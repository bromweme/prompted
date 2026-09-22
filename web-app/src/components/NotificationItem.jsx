import { Link } from 'react-router-dom'
import { timeAgo } from '../hooks/useNotifications'

// One notification (NT-1), shared by the bell and the Notifications page.
// The link carries state so that opening it from the page it points at still
// reloads that page: e.g. "You're in!" while on the group's view-only page.
function NotificationItem({ item, isNew = false, onOpen, onRemove }) {
  return (
    <li className={`notification-item${isNew ? ' is-new' : ''}`}>
      {isNew && <span className="visually-hidden">New: </span>}
      <div className="notification-row">
        <span className="notification-text">{item.text}</span>
        <button
          type="button"
          className="notification-remove"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove notification: ${item.text}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <span className="notification-meta">
        <span className="notification-time">{timeAgo(item.createdAt)}</span>
        {item.link && (
          <Link
            to={item.link}
            state={{ fromNotification: item.id }}
            className="notification-link"
            onClick={onOpen}
            aria-label={`Open: ${item.text}`}
          >
            Open
          </Link>
        )}
      </span>
    </li>
  )
}

export default NotificationItem
