import { useState, useEffect } from 'react'
import { useSocket } from '../context/SocketContext'

export const useTopics = (gameId = 'global') => {
  const { socket, isConnected } = useSocket()
  const [themes, setThemes] = useState([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingTheme, setEditingTheme] = useState(null)
  const [newTheme, setNewTheme] = useState('')
  const [isPublic, setIsPublic] = useState(false)

  useEffect(() => {
    if (!socket || !isConnected) return

    // Load topics from server
    socket.emit('get_topics', { gameId })

    socket.on('topics_list', ({ privateTopics, publicTopics }) => {
      // Combine both private and public topics
      const allTopics = [...privateTopics, ...publicTopics]
      setThemes(allTopics)
    })

    socket.on('topic_submitted', ({ topic }) => {
      // Refresh topics list after submission
      socket.emit('get_topics', { gameId })
    })

    socket.on('topic_deleted', ({ topicId }) => {
      // Refresh topics list after deletion
      socket.emit('get_topics', { gameId })
    })

    return () => {
      socket.off('topics_list')
      socket.off('topic_submitted')
      socket.off('topic_deleted')
    }
  }, [socket, isConnected, gameId])

  const handleAddTheme = () => {
    if (!newTheme.trim()) {
      alert('Please enter a theme idea')
      return
    }

    if (!isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('submit_topic', { 
      gameId, 
      text: newTheme.trim(), 
      isPublic 
    })
    setNewTheme('')
    setIsPublic(false)
    setShowAddModal(false)
  }

  const handleEditTheme = (theme) => {
    setEditingTheme(theme)
    setNewTheme(theme.text)
    setIsPublic(theme.isPublic)
    setShowAddModal(true)
  }

  const handleUpdateTheme = () => {
    if (!newTheme.trim()) {
      alert('Please enter a theme idea')
      return
    }

    if (!isConnected) {
      alert('Please wait for server connection')
      return
    }

    // Delete old topic and create new one (since we don't have update endpoint)
    if (editingTheme) {
      socket.emit('delete_topic', { topicId: editingTheme.id, gameId })
      socket.emit('submit_topic', { 
        gameId, 
        text: newTheme.trim(), 
        isPublic 
      })
    }
    
    setNewTheme('')
    setIsPublic(false)
    setEditingTheme(null)
    setShowAddModal(false)
  }

  const handleDeleteTheme = (topicId) => {
    if (confirm('Are you sure you want to delete this theme idea?')) {
      if (!isConnected) {
        alert('Please wait for server connection')
        return
      }
      socket.emit('delete_topic', { topicId, gameId })
    }
  }

  const handleCloseModal = () => {
    setShowAddModal(false)
    setNewTheme('')
    setEditingTheme(null)
    setIsPublic(false)
  }

  const handleSubmitTheme = (e) => {
    e.preventDefault()
    if (editingTheme) {
      handleUpdateTheme()
    } else {
      handleAddTheme()
    }
  }

  return {
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
  }
}