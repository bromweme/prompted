import { useEffect, useRef, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'

// Open groups (OG-1): groups anyone can find and ask to join. Shared by the
// dashboard preview and the Open Groups search page so the two can't drift.
//
// The server pings every client whenever any group's listing changes. Every
// event a socket sends draws from the same rate-limit bucket as the player's
// real actions, so a burst of changes is coalesced into one refetch rather
// than one per ping.
const CHANGE_COALESCE_MS = 1000

export function useOpenGroups({ query = '', limit, offset = 0 } = {}) {
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  const [groups, setGroups] = useState([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const latestRequest = useRef(0)

  useEffect(() => {
    if (!socket || !isConnected || !user) return

    let timer = null
    const fetchList = () => {
      latestRequest.current += 1
      socket.emit('get_open_groups', { query, limit, offset, requestId: latestRequest.current })
    }
    const onList = ({ groups: listed, total: count, requestId }) => {
      // A reply to a search that has since been replaced is dropped, so fast
      // typing can't leave older results on screen.
      if (requestId !== latestRequest.current) return
      setGroups(listed)
      setTotal(count)
      setLoaded(true)
    }
    const onChanged = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        fetchList()
      }, CHANGE_COALESCE_MS)
    }

    socket.on('open_groups_list', onList)
    socket.on('open_groups_changed', onChanged)
    fetchList()

    return () => {
      clearTimeout(timer)
      socket.off('open_groups_list', onList)
      socket.off('open_groups_changed', onChanged)
    }
  }, [socket, isConnected, user, query, limit, offset])

  return { groups, total, loaded }
}
