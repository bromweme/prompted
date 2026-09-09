import { useEffect, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import './TopicPicker.css'

/**
 * The Round Leader's topic chooser: their own library plus the public topics
 * of the people they're playing with, with anything already played in this
 * group marked.
 *
 * It can also create a topic on the spot. That is what closes the old gap
 * where a round could start with no topics available at all — previously the
 * round silently fell back to a placeholder title.
 */
function TopicPicker({ groupId, onSelect }) {
  const { socket, isConnected } = useSocket()
  const [topics, setTopics] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [newTopic, setNewTopic] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!socket || !isConnected) return undefined

    const handleList = ({ groupId: forGroup, topics: list }) => {
      if (forGroup !== groupId) return
      setTopics(list || [])
      setLoaded(true)
    }

    // A newly created topic is immediately usable, so refresh rather than
    // guessing at what the server stored.
    const handleCreated = () => {
      setPending(false)
      setNewTopic('')
      setIsPublic(false)
      socket.emit('get_group_topics', { groupId })
    }

    socket.on('group_topics_list', handleList)
    socket.on('topic_submitted', handleCreated)
    socket.emit('get_group_topics', { groupId })

    return () => {
      socket.off('group_topics_list', handleList)
      socket.off('topic_submitted', handleCreated)
    }
  }, [socket, isConnected, groupId])

  const handleCreate = (e) => {
    e.preventDefault()
    const text = newTopic.trim()
    if (!text || !socket || !isConnected) return
    setPending(true)
    socket.emit('submit_topic', { text, isPublic })
  }

  return (
    <div className="topic-picker">
      <h4 id="topic-picker-heading">Choose this round's topic</h4>

      {loaded && topics.length === 0 && (
        <p className="topic-picker-empty">
          You don't have any topics yet, and nobody in this group has shared one.
          Write the first one below.
        </p>
      )}

      {topics.length > 0 && (
        <ul className="topic-list" aria-labelledby="topic-picker-heading">
          {topics.map((topic) => (
            <li key={topic.id}>
              <button
                type="button"
                className={`topic-option ${topic.usedInGroup ? 'used' : ''}`}
                onClick={() => onSelect(topic.id)}
              >
                <span className="topic-text">{topic.text}</span>
                <span className="topic-tags">
                  {topic.isOwn ? (
                    <span className="topic-tag">{topic.isPublic ? '🌐 Yours · public' : '🔒 Yours'}</span>
                  ) : (
                    <span className="topic-tag">Shared by {topic.ownerName}</span>
                  )}
                  {/* Used in this group only — the same topic is still fresh
                      in every other group. */}
                  {topic.usedInGroup && <span className="topic-tag topic-tag-used">Already played here</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="topic-create" onSubmit={handleCreate}>
        <div className="form-group">
          <label htmlFor="new-topic">Or write a new one</label>
          <input
            id="new-topic"
            type="text"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="e.g. A song that should have been a hit"
            maxLength={300}
          />
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          <span>Share with this group</span>
        </label>
        <button type="submit" className="submit-button" disabled={!newTopic.trim() || pending}>
          {pending ? 'Saving…' : 'Add to my topics'}
        </button>
      </form>
    </div>
  )
}

export default TopicPicker
