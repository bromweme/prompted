import { Link } from 'react-router-dom'
import './OpenGroupCard.css'

// One open group (OG-1), used on the dashboard preview (compact) and the Open
// Groups page (with description). View opens the group page, which shows a
// view-only version with Request to Join to anyone who isn't a member (JR-1).
// Rendered as a list item, so the parent provides the <ul>.
function OpenGroupCard({ group, compact = false }) {
  const players = `${group.playerCount} ${group.playerCount === 1 ? 'player' : 'players'}`

  return (
    <li className={`group-card open-group-card${compact ? ' compact' : ''}`}>
      <div className="group-header">
        <h3>{group.name}</h3>
      </div>

      {!compact && group.description && (
        <p className="group-description">{group.description}</p>
      )}

      <p className="open-group-meta">
        <span>Host: {group.hostName || 'Unknown'}</span>
        <span>{players}</span>
      </p>

      <div className="open-group-footer">
        <Link
          to={`/group/${group.id}`}
          className="submit-button open-group-view"
          aria-label={`View ${group.name}`}
        >
          View
        </Link>
        {group.requested && <span className="open-group-requested">Requested</span>}
      </div>
    </li>
  )
}

export default OpenGroupCard
