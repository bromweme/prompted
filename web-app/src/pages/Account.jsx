import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { useTopics } from '../hooks/useTopics'
import { useSocket } from '../context/SocketContext'
import { useModalA11y } from '../hooks/useModalA11y'
import AppNav from '../components/AppNav'
import AvatarPicker from '../components/AvatarPicker'
import './Account.css'

function Account() {
  const navigate = useNavigate()
  const { user, signOut } = useUser()
  const { socket, isConnected } = useSocket()
  const [saveError, setSaveError] = useState(null)
  const themeModalRef = useRef(null)

  // Account deletion (PRIV-1). The privacy policy promises erasure, so this
  // button has to do it rather than say "coming soon", which is what it said
  // while the policy already claimed the right existed.
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteError, setDeleteError] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const deleteModalRef = useRef(null)

  // Declared here rather than with the other handlers: useModalA11y below
  // takes it as its close callback, and a const declared later is still in
  // its temporal dead zone at that point.
  const closeDeleteModal = () => {
    setShowDeleteModal(false)
    setDeleteConfirm('')
    setDeleteError(null)
  }
  
  const [activeTab, setActiveTab] = useState('profile')
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', avatar: '' })

  // Use shared topics hook
  const {
    themes,
    showAddModal,
    setShowAddModal,
    editingTheme,
    newTheme,
    setNewTheme,
    isPublic,
    setIsPublic,
    handleAddTheme,
    handleEditTheme,
    handleUpdateTheme,
    handleDeleteTheme,
    handleCloseModal,
    handleSubmitTheme
  } = useTopics('global')

  useModalA11y(showAddModal, themeModalRef, handleCloseModal)
  useModalA11y(showDeleteModal, deleteModalRef, closeDeleteModal)

  // The server is the source of truth: it echoes the saved profile back
  // through the session payload, which re-runs this and closes the form.
  useEffect(() => {
    if (user) {
      setEditForm({ name: user.name, avatar: user.avatar })
      setIsEditing(false)
    }
  }, [user])

  const handleEditClick = () => {
    setEditForm({ name: user.name, avatar: user.avatar })
    setSaveError(null)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setSaveError(null)
    setEditForm({ name: user.name, avatar: user.avatar })
  }

  const handleSaveProfile = () => {
    if (!socket || !isConnected) {
      setSaveError('Still connecting — try again in a moment.')
      return
    }

    setSaveError(null)
    socket.once('error', ({ message }) => setSaveError(message))
    socket.emit('update_profile', { displayName: editForm.name, avatar: editForm.avatar })
  }

  const handleAvatarSelect = (avatar) => {
    setEditForm({ ...editForm, avatar })
  }

  const handleLogout = () => {
    signOut()
    navigate('/')
  }

  // Typing the word is deliberate friction. This cannot be undone and it can
  // change other people's groups (a group this player hosts is handed to
  // someone else), so a single mis-click should not be enough.
  const deleteArmed = deleteConfirm.trim().toUpperCase() === 'DELETE'

  const handleDeleteAccount = () => {
    if (!deleteArmed || deleting) return
    if (!socket || !isConnected) {
      setDeleteError('Still connecting — try again in a moment.')
      return
    }

    setDeleteError(null)
    setDeleting(true)
    socket.emit('delete_account', { confirm: true })
  }

  // The server answers exactly once, either way. Both listeners are torn down
  // together so a failed attempt cannot leave one armed for the next.
  useEffect(() => {
    if (!socket || !deleting) return

    const onDeleted = () => {
      // Sign out first: the account is gone, so any further socket traffic
      // under the old identity would just recreate an empty profile.
      signOut()
      navigate('/')
    }
    const onError = ({ message }) => {
      setDeleting(false)
      setDeleteError(message || 'Could not delete the account.')
    }

    socket.on('account_deleted', onDeleted)
    socket.on('error', onError)
    return () => {
      socket.off('account_deleted', onDeleted)
      socket.off('error', onError)
    }
  }, [socket, deleting, signOut, navigate])

  if (!user) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="account-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <AppNav />

      <main id="main-content" className="account-main">
        <h1 className="page-title">Account Settings</h1>
        <div className="account-content">
          {/* Tab Navigation */}
          <nav className="account-tabs" aria-label="Account sections">
            <button 
              className={`tab-button ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveTab('profile')}
              aria-current={activeTab === 'profile' ? 'page' : undefined}
            >
              Profile
            </button>
            <button 
              className={`tab-button ${activeTab === 'themes' ? 'active' : ''}`}
              onClick={() => setActiveTab('themes')}
              aria-current={activeTab === 'themes' ? 'page' : undefined}
            >
              Theme Ideas
            </button>
            <button 
              className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
              aria-current={activeTab === 'settings' ? 'page' : undefined}
            >
              Settings
            </button>
          </nav>

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <section className="profile-section">
              <div className="section-header">
                <h2>Profile</h2>
                {!isEditing && (
                  <button 
                    className="edit-button"
                    onClick={handleEditClick}
                    aria-label="Edit profile"
                  >
                    Edit Profile
                  </button>
                )}
              </div>

            <div className="profile-card">
              <div className="profile-avatar-section">
                <div className="current-avatar">
                  {/* Google accounts come with a profile picture; the emoji
                      picker below is still the fallback for accounts without
                      one, and for anyone who'd rather pick their own. */}
                  {!isEditing && !user.avatar && user.picture ? (
                    <img className="avatar-photo" src={user.picture} alt="" width="110" height="110" />
                  ) : (
                    <span className="avatar-display">{isEditing ? editForm.avatar : (user.avatar || '🎵')}</span>
                  )}
                </div>
                {isEditing && (
                  <div className="avatar-selector">
                    <h3 id="account-avatar-label">Choose Avatar</h3>
                    <AvatarPicker
                      value={editForm.avatar}
                      onChange={handleAvatarSelect}
                      labelledBy="account-avatar-label"
                    />
                  </div>
                )}
              </div>

              <div className="profile-details">
                {isEditing ? (
                  <div className="edit-form">
                    <div className="form-group">
                      <label htmlFor="display-name">Display Name</label>
                      <input
                        id="display-name"
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        placeholder="Enter your display name"
                        maxLength={100}
                      />
                    </div>

                    {saveError && <p className="save-error" role="alert">{saveError}</p>}

                    <div className="form-actions">
                      <button 
                        className="cancel-button"
                        onClick={handleCancelEdit}
                      >
                        Cancel
                      </button>
                      <button 
                        className="save-button"
                        onClick={handleSaveProfile}
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="view-form">
                    <div className="detail-row">
                      <span className="detail-label">Display Name</span>
                      <span className="detail-value">{user.name}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">{user.email}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

          {/* Theme Ideas Tab */}
          {activeTab === 'themes' && (
            <section className="themes-section">
              <div className="section-header">
                <h2>Theme Ideas</h2>
                <button 
                  className="add-button"
                  onClick={() => setShowAddModal(true)}
                  aria-label="Add new theme idea"
                  disabled={!isConnected}
                >
                  <span className="button-icon" aria-hidden="true">+</span>
                  Add Theme
                </button>
              </div>

              {!isConnected && (
                <div className="connection-warning">
                  <p>⚠️ Please wait for server connection to manage theme ideas</p>
                </div>
              )}

              {isConnected && themes.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon" aria-hidden="true">💡</div>
                  <h3>No theme ideas yet</h3>
                  <p>Start saving your creative theme ideas!</p>
                  <button 
                    className="add-button empty"
                    onClick={() => setShowAddModal(true)}
                  >
                    Add Your First Theme
                  </button>
                </div>
              ) : isConnected && (
                <div className="themes-grid">
                  {themes.map((theme) => (
                    <article key={theme.id} className="theme-card">
                      <div className="theme-card-header">
                        <span className="theme-date">
                          {new Date(theme.createdAt).toLocaleDateString()}
                        </span>
                        <span className={`topic-badge ${theme.isPublic ? 'public' : 'private'}`}>
                          {theme.isPublic ? '🌐 Public' : '🔒 Private'}
                        </span>
                        <div className="theme-actions">
                          <button 
                            className="action-button edit"
                            onClick={() => handleEditTheme(theme)}
                            aria-label={`Edit ${theme.text}`}
                          >
                            Edit
                          </button>
                          <button 
                            className="action-button delete"
                            onClick={() => handleDeleteTheme(theme.id)}
                            aria-label={`Delete ${theme.text}`}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="theme-card-body">
                        <p className="theme-text">{theme.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              <div className="quick-ideas-section">
                <h3>Quick Theme Inspiration</h3>
                <div className="quick-ideas-grid">
                  <button
                    type="button"
                    className="quick-idea-card"
                    disabled={!isConnected}
                    onClick={() => { setNewTheme('Songs from your childhood'); setShowAddModal(true); }}
                  >
                    <span className="idea-icon" aria-hidden="true">👶</span>
                    <h4>Childhood Favorites</h4>
                  </button>
                  <button
                    type="button"
                    className="quick-idea-card"
                    disabled={!isConnected}
                    onClick={() => { setNewTheme('Songs for a rainy day'); setShowAddModal(true); }}
                  >
                    <span className="idea-icon" aria-hidden="true">🌧️</span>
                    <h4>Rainy Day Vibes</h4>
                  </button>
                  <button
                    type="button"
                    className="quick-idea-card"
                    disabled={!isConnected}
                    onClick={() => { setNewTheme('Feel-good summer songs'); setShowAddModal(true); }}
                  >
                    <span className="idea-icon" aria-hidden="true">☀️</span>
                    <h4>Summer Hits</h4>
                  </button>
                  <button
                    type="button"
                    className="quick-idea-card"
                    disabled={!isConnected}
                    onClick={() => { setNewTheme('Late night study music'); setShowAddModal(true); }}
                  >
                    <span className="idea-icon" aria-hidden="true">📚</span>
                    <h4>Study Focus</h4>
                  </button>
                  <button
                    type="button"
                    className="quick-idea-card"
                    disabled={!isConnected}
                    onClick={() => { setNewTheme('Songs that get you pumped up'); setShowAddModal(true); }}
                  >
                    <span className="idea-icon" aria-hidden="true">💪</span>
                    <h4>Energy Boosters</h4>
                  </button>
                  <button
                    type="button"
                    className="quick-idea-card"
                    disabled={!isConnected}
                    onClick={() => { setNewTheme('Relaxing evening songs'); setShowAddModal(true); }}
                  >
                    <span className="idea-icon" aria-hidden="true">🌙</span>
                    <h4>Evening Wind Down</h4>
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <section className="settings-section">
              <h2>Account Settings</h2>
              
              <div className="settings-list">
                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Email Notifications</h3>
                    <p>Receive updates about your groups and submissions</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked aria-label="Email Notifications" />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Public Profile</h3>
                    <p>Allow others to see your profile and stats</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked aria-label="Public Profile" />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Sound Effects</h3>
                    <p>Play sounds when submitting songs and winning rounds</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" aria-label="Sound Effects" />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="danger-section">
                <h2>Danger Zone</h2>
                {/* The policy describes exactly what Delete Account does, so it
                    belongs next to the button rather than only on the sign-in
                    screen, which a signed-in player never sees again. */}
                <p className="danger-policy-link">
                  <Link to="/privacy">What we store, and what deleting removes</Link>
                </p>
                
                <div className="danger-actions">
                  <button 
                    className="danger-button secondary"
                    onClick={() => setShowDeleteModal(true)}
                  >
                    Delete Account
                  </button>
                  <button 
                    className="danger-button primary"
                    onClick={handleLogout}
                  >
                    Log Out
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {showAddModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          ref={themeModalRef}
          onClick={handleCloseModal}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="modal-title">{editingTheme ? 'Edit Theme' : 'Add New Theme'}</h2>
              <button 
                className="close-button"
                onClick={handleCloseModal}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            {!isConnected ? (
              <div className="modal-body">
                <div className="connection-warning">
                  <p>⚠️ Please wait for server connection to manage theme ideas</p>
                </div>
              </div>
            ) : (
              <form className="modal-body" onSubmit={handleSubmitTheme}>
                <div className="form-group">
                  <label htmlFor="theme-text">Theme Idea *</label>
                  <textarea
                    id="theme-text"
                    value={newTheme}
                    onChange={(e) => setNewTheme(e.target.value)}
                    placeholder="Enter your theme idea (e.g., 'Songs that describe your mood today')"
                    rows={3}
                    required
                    maxLength={100}
                  />
                  <small className="form-hint">Be creative! The more specific, the better the submissions will be.</small>
                </div>

                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                    />
                    Make Public (visible to all players)
                  </label>
                </div>

                <div className="modal-actions">
                  <button 
                    type="button"
                    className="cancel-button"
                    onClick={handleCloseModal}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="submit-button"
                    disabled={!newTheme.trim()}
                  >
                    {editingTheme ? 'Update Theme' : 'Add Theme'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          aria-describedby="delete-account-detail"
          ref={deleteModalRef}
          onClick={closeDeleteModal}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="delete-account-title">Delete Account</h2>
              <button
                className="close-button"
                onClick={closeDeleteModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modal-body" id="delete-account-detail">
              {/* Saying exactly what happens, including the parts that are not
                  deletion. A vague warning invites a mis-click; this is the
                  same list the privacy policy gives. */}
              <p>This cannot be undone. Deleting your account will:</p>
              <ul className="delete-account-list">
                <li>Delete your profile, your saved topics and your notifications</li>
                <li>Remove you from every group you are in</li>
                <li>Hand any group you host to its longest-standing member, or delete it if you are the only one there</li>
                <li>Remove your name from rounds other players took part in, keeping their scores and history intact</li>
              </ul>
              <p className="delete-account-note">
                Any ban on your account stays in place, so deleting is not a way back
                into a group you were removed from.
              </p>

              {/* .form-group, not a bespoke rule: its input styling already
                  carries the 3:1 border WCAG 1.4.11 wants, which a hand-rolled
                  --color-border box does not (1.51:1 on a white panel). */}
              <div className="form-group">
                <label htmlFor="delete-confirm">Type <strong>DELETE</strong> to confirm</label>
                <input
                  id="delete-confirm"
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  autoComplete="off"
                  disabled={deleting}
                />
              </div>

              {deleteError && (
                <p className="save-error" role="alert">{deleteError}</p>
              )}
            </div>

            <div className="modal-actions">
              <button
                className="setup-button secondary"
                onClick={closeDeleteModal}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="danger-button primary"
                onClick={handleDeleteAccount}
                disabled={!deleteArmed || deleting}
              >
                {deleting ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Account
