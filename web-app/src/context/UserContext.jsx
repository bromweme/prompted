import { createContext, useContext, useState, useEffect } from 'react'

const UserContext = createContext()

export const useUser = () => {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null)

  useEffect(() => {
    // Load user data from localStorage
    const savedUser = localStorage.getItem('user')
    if (savedUser) {
      setUser(JSON.parse(savedUser))
    } else {
      // Initialize with default user
      const defaultUser = {
        id: 'user123',
        name: 'Music Lover',
        email: 'user@spotify.com',
        avatar: '🎵',
        bio: '',
        location: ''
      }
      setUser(defaultUser)
      localStorage.setItem('user', JSON.stringify(defaultUser))
    }
  }, [])

  const updateUser = (updates) => {
    setUser(prevUser => {
      const updatedUser = { ...prevUser, ...updates }
      localStorage.setItem('user', JSON.stringify(updatedUser))
      return updatedUser
    })
  }

  const value = {
    user,
    updateUser,
    setUser
  }

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}
