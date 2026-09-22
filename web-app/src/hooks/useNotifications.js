import { useCallback, useEffect, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'

// Notifications (NT-1), shared by the header bell and the Notifications page
// so the two can't drift. The server keeps the list and pushes changes to
// every tab the player has open, so a removal in one shows in all.
export function useNotifications() {
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!socket || !isConnected || !user) return

    const onList = ({ items: list, unreadCount: count }) => {
      setItems(list || [])
      setUnreadCount(count || 0)
      setLoaded(true)
    }
    const onNew = ({ item, unreadCount: count }) => {
      setItems((prev) => [item, ...prev.filter((n) => n.id !== item.id)])
      setUnreadCount(count)
    }

    socket.on('notifications_list', onList)
    socket.on('notification', onNew)
    socket.emit('get_notifications')
    return () => {
      socket.off('notifications_list', onList)
      socket.off('notification', onNew)
    }
  }, [socket, isConnected, user])

  const markRead = useCallback(() => {
    if (socket && unreadCount > 0) socket.emit('mark_notifications_read')
  }, [socket, unreadCount])

  const remove = useCallback((id) => {
    if (!socket) return
    setItems((prev) => prev.filter((n) => n.id !== id))
    socket.emit('delete_notification', { notificationId: id })
  }, [socket])

  const clearAll = useCallback(() => {
    if (!socket) return
    setItems([])
    setUnreadCount(0)
    socket.emit('clear_notifications')
  }, [socket])

  return { items, unreadCount, loaded, markRead, remove, clearAll }
}

// "5m ago" style, coarse on purpose: the list is about what happened, not
// exact times.
export function timeAgo(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
