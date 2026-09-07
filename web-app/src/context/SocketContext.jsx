import { createContext, useContext, useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import { useUser } from './UserContext'

const SocketContext = createContext(null)

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const { authPayload, onSession, onAuthFailure } = useUser()

  // Held in refs so the connection effect depends only on the credential and
  // isn't torn down every time one of these callbacks is re-created.
  const onSessionRef = useRef(onSession)
  const onAuthFailureRef = useRef(onAuthFailure)
  onSessionRef.current = onSession
  onAuthFailureRef.current = onAuthFailure

  // The credential itself, serialised, so reconnecting with the *same* token
  // doesn't tear down and rebuild the socket on every render.
  const authKey = authPayload ? JSON.stringify(authPayload) : null

  useEffect(() => {
    // No credential means no connection: the server authenticates at the
    // handshake, so an unauthenticated socket would only be refused.
    if (!authKey) {
      setSocket(null)
      setIsConnected(false)
      return undefined
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'
    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      auth: JSON.parse(authKey)
    })

    setSocket(newSocket)

    newSocket.on('connect', () => {
      console.log('Socket connected with ID:', newSocket.id)
      setIsConnected(true)
    })

    // Sent by the server immediately after a successful handshake, carrying
    // the verified identity and a session token for the next reconnect.
    newSocket.on('session', (payload) => {
      onSessionRef.current(payload)
    })

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected')
      setIsConnected(false)
    })

    newSocket.on('connect_error', (error) => {
      console.log('Socket connection error:', error.message)
      setIsConnected(false)
      // AUTH_REQUIRED / AUTH_FAILED mean the credential is the problem, so
      // retrying it is pointless — drop it and send the user back to sign-in.
      if (error.message === 'AUTH_REQUIRED' || error.message === 'AUTH_FAILED') {
        newSocket.disconnect()
        onAuthFailureRef.current('Your session has expired. Please sign in again.')
      }
    })

    return () => {
      newSocket.removeAllListeners()
      newSocket.disconnect()
    }
  }, [authKey])

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
