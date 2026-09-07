import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { SocketProvider } from './context/SocketContext'
import { UserProvider, useUser } from './context/UserContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CreateGroup from './pages/CreateGroup'
import GroupView from './pages/GroupView'
import Account from './pages/Account'
import './App.css'

// Every page but the sign-in screen needs a confirmed identity, because they
// all read user.id. Identity is confirmed by the server over the socket
// handshake, so on a reload there is a short window where a stored credential
// exists but hasn't been checked yet — that window waits rather than
// redirecting, otherwise every refresh would bounce through the login screen.
function RequireAuth({ children }) {
  const { isAuthenticated, isResolvingAuth } = useUser()

  if (isResolvingAuth) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        Signing you in…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return children
}

function App() {
  return (
    <UserProvider>
      <SocketProvider>
        <Router>
          <div className="app">
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/create-group" element={<RequireAuth><CreateGroup /></RequireAuth>} />
              <Route path="/group/:groupId" element={<RequireAuth><GroupView /></RequireAuth>} />
              <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Router>
      </SocketProvider>
    </UserProvider>
  )
}

export default App
