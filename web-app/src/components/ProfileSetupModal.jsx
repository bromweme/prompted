import { useState, useRef } from 'react'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import { useModalA11y } from '../hooks/useModalA11y'
import AvatarPicker from './AvatarPicker'
import './ProfileSetupModal.css'

/**
 * Shown once, on a player's first sign-in, to confirm their display name and
 * pick an avatar. It is deliberately not dismissable by Escape or a backdrop
 * click: the avatar being unset is exactly what triggers it, so dismissing
 * without choosing would just show it again on the next load.
 *
 * Returning players never see it — the server only leaves avatar null once.
 */
function ProfileSetupModal() {
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  const [displayName, setDisplayName] = useState(user?.name || '')
  const [avatar, setAvatar] = useState(null)
  const [error, setError] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const modalRef = useRef(null)

  // Focus trap and initial focus, but no close handler — see above.
  useModalA11y(true, modalRef, null)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!displayName.trim() || !avatar) return
    if (!socket || !isConnected) {
      setError('Still connecting — try again in a moment.')
      return
    }

    setIsSaving(true)
    setError(null)

    // The modal closes when the server echoes the saved profile back through
    // the session payload (user.avatar stops being null), not on click — so
    // what's on screen always reflects what was actually stored.
    socket.once('error', ({ message }) => {
      setIsSaving(false)
      setError(message)
    })

    socket.emit('update_profile', { displayName: displayName.trim(), avatar })
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-setup-title" ref={modalRef}>
      <div className="modal-content profile-setup-modal">
        <div className="modal-header">
          <h2 id="profile-setup-title">Welcome to Prompted!</h2>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <p className="profile-setup-intro">
            Let's set up how you'll appear to other players. You can change this
            any time from your account page.
          </p>

          <div className="form-group">
            <label htmlFor="setup-display-name">Display Name *</label>
            <input
              id="setup-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              required
            />
          </div>

          <div className="form-group">
            <span className="form-label" id="setup-avatar-label">Pick an Avatar *</span>
            <AvatarPicker value={avatar} onChange={setAvatar} labelledBy="setup-avatar-label" />
          </div>

          {error && <p className="profile-setup-error" role="alert">{error}</p>}

          <div className="modal-actions">
            <button
              type="submit"
              className="submit-button"
              disabled={!displayName.trim() || !avatar || isSaving}
            >
              {isSaving ? 'Saving…' : 'Get Started'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ProfileSetupModal
