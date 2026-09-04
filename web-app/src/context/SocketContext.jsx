import { createContext, useContext, useState, useEffect } from 'react'
import io from 'socket.io-client'

const SocketContext = createContext(null)

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // Create socket connection only once
    let newSocket = null
    try {
      const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'
      newSocket = io(socketUrl, {
        reconnection: true,
        reconnectionDelay: 1000
      })
      
      setSocket(newSocket)

      newSocket.on('connect', () => {
        console.log('Socket connected with ID:', newSocket.id)
        setIsConnected(true)
      })

      newSocket.on('disconnect', () => {
        console.log('Socket disconnected')
        setIsConnected(false)
      })

      newSocket.on('reconnect', () => {
        console.log('Socket reconnected with ID:', newSocket.id)
        setIsConnected(true)
      })

      newSocket.on('connect_error', (error) => {
        console.log('Socket connection error:', error.message)
        setIsConnected(false)
      })
    } catch (error) {
      console.log('Socket initialization error:', error)
      setIsConnected(false)
    }

    return () => {
      if (newSocket) {
        newSocket.disconnect()
      }
    }
  }, [])

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}
