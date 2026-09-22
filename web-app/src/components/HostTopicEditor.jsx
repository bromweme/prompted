import { useEffect, useRef, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import './HostTopicEditor.css'

// Mirrors the server's limits (LIMITS.topicText, MAX_HOST_TOPICS), so the
// player hears about a problem before sending, not after. The server still
// checks every rule itself.
const MAX_TOPIC_LENGTH = 300
const MAX_TOPICS = 100
// How long to wait for the server to confirm an add before saying so.
const CONFIRM_TIMEOUT_MS = 8000

const normalize = (text) => text.trim().toLowerCase()

/**
 * The host's topic list for a group with custom topics off (GT-1): add,
 * remove, and see how many are still needed (one per round, since each plays
 * once per game). Used in the Topics tab and in the "Add your topics to
 * start" modal, so both validate the same way.
 */
function HostTopicEditor({ group, needed, inputId = 'host-topic-input' }) {
  const { socket, isConnected } = useSocket()
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [pendingText, setPendingText] = useState(null)
  const errorHandler = useRef(null)
  const inputRef = useRef(null)

  const topics = group.hostTopics || []
  const used = group.usedTopicIds || []
  const unused = topics.filter((t) => !used.includes(t.id)).length
  const remaining = Math.max(needed - unused, 0)

  // The add is confirmed when the topic shows up in the group (checked as it
  // renders); a refusal arrives as an error instead. Either one ends the wait.
  const confirmed = pendingText !== null &&
    topics.some((t) => normalize(t.text) === normalize(pendingText))
  if (confirmed) {
    setPendingText(null)
    setText('')
  }

  // While waiting: give up after a while rather than waiting forever. Once
  // the wait ends, however it ends, stop listening for this add's refusal.
  useEffect(() => {
    if (pendingText === null) {
      if (errorHandler.current) socket?.off('error', errorHandler.current)
      errorHandler.current = null
      return undefined
    }
    const timer = setTimeout(() => {
      setPendingText(null)
      setError("The server didn't confirm that topic. Try again.")
    }, CONFIRM_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pendingText, socket])

  useEffect(() => () => {
    if (errorHandler.current) socket?.off('error', errorHandler.current)
  }, [socket])

  const handleAdd = (e) => {
    e.preventDefault()
    if (pendingText !== null) return
    const trimmed = text.trim()

    let problem = null
    if (!trimmed) problem = 'Type a topic first.'
    else if (trimmed.length > MAX_TOPIC_LENGTH) problem = `Topics can be at most ${MAX_TOPIC_LENGTH} characters.`
    else if (topics.some((t) => normalize(t.text) === normalize(trimmed))) problem = 'That topic is already on the list.'
    else if (topics.length >= MAX_TOPICS) problem = `A group can have at most ${MAX_TOPICS} topics.`
    else if (!socket || !isConnected) problem = 'Waiting for the server connection. Try again in a moment.'
    if (problem) {
      setError(problem)
      inputRef.current?.focus()
      return
    }

    setError(null)
    setPendingText(trimmed)
    const onError = ({ message }) => {
      errorHandler.current = null
      setPendingText(null)
      setError(message || "That topic couldn't be added.")
    }
    errorHandler.current = onError
    socket.once('error', onError)
    socket.emit('add_group_topic', { groupId: group.id, text: trimmed })
  }

  const handleRemove = (topic) => {
    if (!socket || !isConnected) {
      setError('Waiting for the server connection. Try again in a moment.')
      return
    }
    setError(null)
    socket.once('error', ({ message }) => setError(message || "That topic couldn't be removed."))
    socket.emit('remove_group_topic', { groupId: group.id, topicId: topic.id })
  }

  const errorId = `${inputId}-error`
  const countId = `${inputId}-count`

  return (
    <div className="host-topic-editor">
      <div className="host-topic-progress">
        <p className="host-topic-progress-label" role="status">
          {unused} of {needed} added
          {remaining > 0 ? `: add ${remaining} more to start.` : ', ready to play.'}
        </p>
        <div
          className="host-topic-progress-bar"
          role="progressbar"
          aria-label="Topics added"
          aria-valuemin={0}
          aria-valuemax={needed}
          aria-valuenow={Math.min(unused, needed)}
        >
          <span style={{ width: `${needed ? Math.min(unused / needed, 1) * 100 : 100}%` }} />
        </div>
      </div>

      <form className="host-topic-form form-group" onSubmit={handleAdd} noValidate>
        <label htmlFor={inputId}>New topic</label>
        <div className="host-topic-row">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
            placeholder="e.g. A song for a road trip"
            maxLength={MAX_TOPIC_LENGTH}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${countId} ${errorId}` : countId}
          />
          <button type="submit" className="submit-button" disabled={pendingText !== null}>
            {pendingText !== null ? 'Adding…' : 'Add topic'}
          </button>
        </div>
        <small id={countId} className="form-hint">{text.trim().length}/{MAX_TOPIC_LENGTH} characters</small>
        {error && <p id={errorId} className="join-form-error" role="alert">{error}</p>}
      </form>

      {topics.length === 0 ? (
        <p className="requests-empty">No topics yet.</p>
      ) : (
        <ul className="requests-list">
          {topics.map((topic) => {
            const played = used.includes(topic.id)
            return (
              <li key={topic.id} className="request-card">
                <div className="request-info">
                  <span className="participant-name">{topic.text}</span>
                  {played && <span className="form-hint">Played this game</span>}
                </div>
                <div className="request-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={() => handleRemove(topic)}
                    disabled={played}
                    aria-label={played ? `${topic.text} was played this game and can't be removed` : `Remove ${topic.text}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default HostTopicEditor
