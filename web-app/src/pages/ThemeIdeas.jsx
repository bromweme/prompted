import { useNavigate } from 'react-router-dom'
import { useTopics } from '../hooks/useTopics'
import { useSocket } from '../context/SocketContext'
import AppNav from '../components/AppNav'
import './ThemeIdeas.css'

function ThemeIdeas() {
  const navigate = useNavigate()
  const { isConnected } = useSocket()
  
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

  if (!isConnected) {
    return (
      <div className="theme-ideas-page">
        <div className="loading">Connecting to server...</div>
      </div>
    )
  }

  return (
    <div className="theme-ideas-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <AppNav current="topics" />

      <main id="main-content" className="theme-ideas-main">
        <div className="theme-ideas-content">
          <section className="ideas-header">
            <div className="header-info">
              <h1>My Topics</h1>
              <p className="subtitle">
                Your personal topic library, reusable in every group. Shared topics are
                offered to the people you play with; private ones stay yours.
              </p>
            </div>
            <button 
              className="add-button"
              onClick={() => setShowAddModal(true)}
              aria-label="Add new theme idea"
            >
              <span className="button-icon" aria-hidden="true">+</span>
              Add Theme
            </button>
          </section>

          <section className="ideas-list">
            {themes.length === 0 ? (
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
            ) : (
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
          </section>

          <section className="quick-ideas-section">
            <h3>Quick Theme Inspiration</h3>
            <div className="quick-ideas-grid">
              <div className="quick-idea-card" onClick={() => { setNewTheme('Songs from your childhood'); setShowAddModal(true); }}>
                <span className="idea-icon" aria-hidden="true">👶</span>
                <h4>Childhood Favorites</h4>
              </div>
              <div className="quick-idea-card" onClick={() => { setNewTheme('Songs for a rainy day'); setShowAddModal(true); }}>
                <span className="idea-icon" aria-hidden="true">🌧️</span>
                <h4>Rainy Day Vibes</h4>
              </div>
              <div className="quick-idea-card" onClick={() => { setNewTheme('Feel-good summer songs'); setShowAddModal(true); }}>
                <span className="idea-icon" aria-hidden="true">☀️</span>
                <h4>Summer Hits</h4>
              </div>
              <div className="quick-idea-card" onClick={() => { setNewTheme('Late night study music'); setShowAddModal(true); }}>
                <span className="idea-icon" aria-hidden="true">📚</span>
                <h4>Study Focus</h4>
              </div>
              <div className="quick-idea-card" onClick={() => { setNewTheme('Songs that get you pumped up'); setShowAddModal(true); }}>
                <span className="idea-icon" aria-hidden="true">💪</span>
                <h4>Energy Boosters</h4>
              </div>
              <div className="quick-idea-card" onClick={() => { setNewTheme('Relaxing evening songs'); setShowAddModal(true); }}>
                <span className="idea-icon" aria-hidden="true">🌙</span>
                <h4>Evening Wind Down</h4>
              </div>
            </div>
          </section>
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
          </div>
        </div>
      )}
    </div>
  )
}

export default ThemeIdeas
