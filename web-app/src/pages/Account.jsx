import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { useTopics } from '../hooks/useTopics'
import { useSocket } from '../context/SocketContext'
import './Account.css'

function Account() {
  const navigate = useNavigate()
  const { user, updateUser } = useUser()
  const { isConnected } = useSocket()
  
  const [activeTab, setActiveTab] = useState('profile')
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    avatar: '',
    bio: '',
    location: ''
  })

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

  const commonAvatars = ['🎵', '🎸', '🎹', '🎤', '🎧', '🎻', '🥁', '🎷', '🎺', '🎼', '🎹', '🎬', '🎮', '🎲']

  useEffect(() => {
    if (user) {
      setEditForm({
        name: user.name,
        avatar: user.avatar,
        bio: user.bio || '',
        location: user.location || ''
      })
    }
  }, [user])

  const handleEditClick = () => {
    setEditForm({
      name: user.name,
      avatar: user.avatar,
      bio: user.bio || '',
      location: user.location || ''
    })
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditForm({
      name: user.name,
      avatar: user.avatar,
      bio: user.bio || '',
      location: user.location || ''
    })
  }

  const handleSaveProfile = () => {
    updateUser({
      name: editForm.name,
      avatar: editForm.avatar,
      bio: editForm.bio,
      location: editForm.location
    })
    setIsEditing(false)
  }

  const handleAvatarSelect = (avatar) => {
    setEditForm({ ...editForm, avatar })
  }

  const handleLogout = () => {
    // Clear user data from localStorage
    localStorage.removeItem('user')
    navigate('/')
  }

  if (!user) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="account-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <header className="page-header">
        <div className="header-content">
          <button 
            className="back-button"
            onClick={() => navigate('/dashboard')}
            aria-label="Go back to dashboard"
          >
            ← Back to Dashboard
          </button>
          <h1>Account Settings</h1>
        </div>
      </header>

      <main id="main-content" className="account-main">
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
                  <span className="avatar-display">{isEditing ? editForm.avatar : user.avatar}</span>
                </div>
                {isEditing && (
                  <div className="avatar-selector">
                    <h3>Choose Avatar</h3>
                    <div className="avatar-grid">
                      {commonAvatars.map((avatar) => (
                        <button
                          key={avatar}
                          className={`avatar-option ${editForm.avatar === avatar ? 'selected' : ''}`}
                          onClick={() => handleAvatarSelect(avatar)}
                          aria-label={`Select ${avatar} avatar`}
                        >
                          {avatar}
                        </button>
                      ))}
                    </div>
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
                        maxLength={30}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="bio">Bio</label>
                      <textarea
                        id="bio"
                        value={editForm.bio}
                        onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                        placeholder="Tell us about yourself"
                        rows={3}
                        maxLength={150}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="location">Location</label>
                      <input
                        id="location"
                        type="text"
                        value={editForm.location}
                        onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                        placeholder="City, Country"
                        maxLength={50}
                      />
                    </div>

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
                    {user.bio && (
                      <div className="detail-row">
                        <span className="detail-label">Bio</span>
                        <span className="detail-value">{user.bio}</span>
                      </div>
                    )}
                    {user.location && (
                      <div className="detail-row">
                        <span className="detail-label">Location</span>
                        <span className="detail-value">{user.location}</span>
                      </div>
                    )}
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
                  <div 
                    className={`quick-idea-card ${!isConnected ? 'disabled' : ''}`} 
                    onClick={() => { if (isConnected) { setNewTheme('Songs from your childhood'); setShowAddModal(true); }}}
                  >
                    <span className="idea-icon" aria-hidden="true">👶</span>
                    <h4>Childhood Favorites</h4>
                  </div>
                  <div 
                    className={`quick-idea-card ${!isConnected ? 'disabled' : ''}`} 
                    onClick={() => { if (isConnected) { setNewTheme('Songs for a rainy day'); setShowAddModal(true); }}}
                  >
                    <span className="idea-icon" aria-hidden="true">🌧️</span>
                    <h4>Rainy Day Vibes</h4>
                  </div>
                  <div 
                    className={`quick-idea-card ${!isConnected ? 'disabled' : ''}`} 
                    onClick={() => { if (isConnected) { setNewTheme('Feel-good summer songs'); setShowAddModal(true); }}}
                  >
                    <span className="idea-icon" aria-hidden="true">☀️</span>
                    <h4>Summer Hits</h4>
                  </div>
                  <div 
                    className={`quick-idea-card ${!isConnected ? 'disabled' : ''}`} 
                    onClick={() => { if (isConnected) { setNewTheme('Late night study music'); setShowAddModal(true); }}}
                  >
                    <span className="idea-icon" aria-hidden="true">📚</span>
                    <h4>Study Focus</h4>
                  </div>
                  <div 
                    className={`quick-idea-card ${!isConnected ? 'disabled' : ''}`} 
                    onClick={() => { if (isConnected) { setNewTheme('Songs that get you pumped up'); setShowAddModal(true); }}}
                  >
                    <span className="idea-icon" aria-hidden="true">💪</span>
                    <h4>Energy Boosters</h4>
                  </div>
                  <div 
                    className={`quick-idea-card ${!isConnected ? 'disabled' : ''}`} 
                    onClick={() => { if (isConnected) { setNewTheme('Relaxing evening songs'); setShowAddModal(true); }}}
                  >
                    <span className="idea-icon" aria-hidden="true">🌙</span>
                    <h4>Evening Wind Down</h4>
                  </div>
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
                    <input type="checkbox" defaultChecked />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Public Profile</h3>
                    <p>Allow others to see your profile and stats</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Sound Effects</h3>
                    <p>Play sounds when submitting songs and winning rounds</p>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="danger-section">
                <h2>Danger Zone</h2>
                
                <div className="danger-actions">
                  <button 
                    className="danger-button secondary"
                    onClick={() => alert('Account deactivation coming soon!')}
                  >
                    Deactivate Account
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
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-content">
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
    </div>
  )
}

export default Account
