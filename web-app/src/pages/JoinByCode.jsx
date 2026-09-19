import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import AppNav from '../components/AppNav'
import { formatInviteCode, normalizeInviteCode } from '../utils/inviteCode'
import './JoinByCode.css'

/**
 * /join/:code — the shareable invite link (UI-2).
 *
 * Sends the code to the server once, then replaces this entry in the history
 * with the group, so Back from the group does not re-run the join. A bad code
 * or a throttled attempt stays here with the server's message and a way back.
 *
 * Signed-out visitors never reach this component: RequireAuth sends them to
 * sign-in carrying this location, and sign-in returns them here to finish.
 */
function JoinByCode() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  // The refusal for a given code, kept with the code it belongs to so moving
  // to a different /join/<code> never shows the previous one's error.
  const [failure, setFailure] = useState({ code: null, message: null })
  // The socket + code this page has already asked the server about.
  // StrictMode re-runs the effect; the join itself must only be sent once per
  // connection (a brand-new socket after re-authentication asks again).
  const sentFor = useRef({ socket: null, code: null })

  const inviteCode = normalizeInviteCode(code || '')
  const error = !inviteCode
    ? 'Invite code not found'
    : (failure.code === inviteCode ? failure.message : null)

  useEffect(() => {
    if (!socket || !isConnected || !user || !inviteCode) return undefined

    const onJoined = ({ group }) => {
      navigate(`/group/${group.id}`, { replace: true, state: { groupData: group } })
    }
    const onError = ({ message }) => {
      setFailure({ code: inviteCode, message: message || 'This invite could not be used' })
    }
    socket.on('group_joined', onJoined)
    socket.on('error', onError)

    if (sentFor.current.socket !== socket || sentFor.current.code !== inviteCode) {
      sentFor.current = { socket, code: inviteCode }
      socket.emit('join_group', { inviteCode, via: 'link' })
    }

    return () => {
      socket.off('group_joined', onJoined)
      socket.off('error', onError)
    }
  }, [socket, isConnected, user, inviteCode, navigate])

  return (
    <div className="join-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <AppNav />

      <main id="main-content" className="join-main">
        <section className="join-card" aria-labelledby="join-title">
          {error ? (
            <>
              <h1 id="join-title" className="join-title">Couldn't join this group</h1>
              <p className="join-error" role="alert">{error}</p>
              <p className="join-hint">
                Check the link with whoever sent it. Invite codes change when the host resets them.
              </p>
              {inviteCode && (
                <p className="join-code">
                  Code: <span className="join-code-value">{formatInviteCode(inviteCode)}</span>
                </p>
              )}
              <button className="submit-button" onClick={() => navigate('/dashboard', { replace: true })}>
                Back to Dashboard
              </button>
            </>
          ) : (
            <>
              <h1 id="join-title" className="join-title">Joining group…</h1>
              <p className="join-hint" role="status" aria-live="polite">
                {isConnected ? 'Checking your invite.' : 'Connecting to the server.'}
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

export default JoinByCode
