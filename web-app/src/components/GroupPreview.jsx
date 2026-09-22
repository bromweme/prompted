import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import './GroupPreview.css'

// The view-only group page for someone who isn't a member (JR-1): what the
// group is and who's in it, plus a Request to Join button. The host accepts
// or declines. A private or missing group has no preview, and the page falls
// back to the usual "not a member" message (`notMember`).
function GroupPreview({ groupId, onAccepted, notMember }) {
  const { socket, isConnected } = useSocket()
  const [preview, setPreview] = useState(undefined)
  const [request, setRequest] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  // Accepted while on this page. The player chooses when to go in, rather
  // than being switched over mid-thought (they may be busy elsewhere).
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!socket || !isConnected) return

    const onPreview = ({ groupId: gid, preview: view }) => {
      if (gid !== groupId) return
      setPreview(view)
      setRequest(view ? view.request : null)
    }
    // Arrives for this player's own requests: sent, cancelled, accepted,
    // declined, refused, or a ban. Refusals come on this channel too, rather
    // than through the shared 'error' event, whose listeners the group page
    // clears on refresh. A decline shows through the request state below.
    const onRequestUpdate = ({ groupId: gid, request: state, outcome, error }) => {
      if (gid !== groupId) return
      setBusy(false)
      setRequest(state)
      if (outcome === 'accepted') setAccepted(true)
      else if (error) setMessage(error)
    }

    socket.on('group_preview', onPreview)
    socket.on('join_request_update', onRequestUpdate)
    socket.emit('get_group_preview', { groupId })

    return () => {
      socket.off('group_preview', onPreview)
      socket.off('join_request_update', onRequestUpdate)
    }
  }, [socket, isConnected, groupId])

  const sendRequest = () => {
    if (!socket || busy) return
    setBusy(true)
    setMessage(null)
    socket.emit('request_join', { groupId })
  }

  const cancelRequest = () => {
    if (!socket || busy) return
    setBusy(true)
    setMessage(null)
    socket.emit('cancel_join_request', { groupId })
  }

  if (preview === undefined) {
    return <div className="loading">Loading...</div>
  }
  if (preview === null) {
    return notMember
  }

  const status = request?.status || 'none'
  const declinesLeft = request?.declinesLeft ?? 3
  const settings = preview.settings || {}

  return (
    <main id="main-content" className="group-preview-main">
      <section className="group-preview-card" aria-labelledby="group-preview-title">
        <Link to="/open-groups" className="group-preview-back">← Back to open groups</Link>
        <p className="group-preview-eyebrow">View only</p>
        <h1 id="group-preview-title">{preview.name}</h1>
        {preview.description && <p className="group-preview-description">{preview.description}</p>}

        <dl className="group-preview-facts">
          <div>
            <dt>Host</dt>
            <dd>{preview.hostName || 'Unknown'}</dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd>{preview.playerCount}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {preview.status === 'setup'
                ? 'Not started'
                : preview.roundInProgress
                  ? `Round ${preview.currentRound} in progress`
                  : `Between rounds (round ${preview.currentRound} done)`}
            </dd>
          </div>
          {settings.totalRounds && (
            <div>
              <dt>Rounds</dt>
              <dd>{settings.totalRounds}</dd>
            </div>
          )}
        </dl>

        <h2>Members</h2>
        <ul className="group-preview-members">
          {preview.members.map((member, index) => (
            <li key={`${member.username}-${index}`}>
              {member.username}
              {member.isHost && <span className="host-badge">Host</span>}
            </li>
          ))}
        </ul>

        <div className="group-preview-actions">
          {accepted && (
            <>
              <p className="group-preview-state" role="status">
                You're in! Your request to join {preview.name} was accepted.
              </p>
              <button type="button" className="submit-button" onClick={onAccepted}>
                Open group
              </button>
            </>
          )}

          {!accepted && status === 'none' && (
            <>
              <button type="button" className="submit-button" onClick={sendRequest} disabled={busy}>
                Request to Join
              </button>
              {declinesLeft < 3 && (
                <p className="group-preview-state" role="status">
                  Your request to join was declined. You can ask {declinesLeft}{' '}
                  more {declinesLeft === 1 ? 'time' : 'times'}.
                </p>
              )}
            </>
          )}

          {status === 'pending' && (
            <>
              <p className="group-preview-state" role="status">
                Request sent. The host will let you in or decline.
                {preview.roundInProgress && ' A round is under way, so they can only accept once it ends.'}
              </p>
              <button type="button" className="cancel-button" onClick={cancelRequest} disabled={busy}>
                Cancel request
              </button>
            </>
          )}

          {status === 'blocked' && (
            <p className="group-preview-state" role="status">
              The host has declined your requests to this group, so you can't ask again.
            </p>
          )}

          {status === 'banned' && (
            <p className="group-preview-state" role="status">
              You have been banned from this group. Think about what you've done.
            </p>
          )}

          {message && <p className="join-form-error" role="alert">{message}</p>}
        </div>
      </section>
    </main>
  )
}

export default GroupPreview
