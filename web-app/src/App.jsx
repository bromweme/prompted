import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { SocketProvider } from './context/SocketContext'
import { UserProvider, useUser } from './context/UserContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CreateGroup from './pages/CreateGroup'
import GroupView from './pages/GroupView'
import JoinByCode from './pages/JoinByCode'
import Account from './pages/Account'
import ThemeIdeas from './pages/ThemeIdeas'
import './App.css'

// Every page but the sign-in screen needs a confirmed identity, because they
// all read user.id. Identity is confirmed by the server over the socket
// handshake, so on a reload there is a short window where a stored credential
// exists but hasn't been checked yet — that window waits rather than
// redirecting, otherwise every refresh would bounce through the login screen.
//
// A signed-out visitor is sent to sign-in carrying the address they asked for
// (router state `from`), and Login returns them there afterwards — so an
// invite link opened while signed out still ends in the join (UI-2).
function RequireAuth({ children }) {
  const { isAuthenticated, isResolvingAuth } = useUser()
  const location = useLocation()

  if (isResolvingAuth) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        Signing you in…
      </div>
    )
  }

  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/" replace state={{ from }} />
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
              {/* The shareable invite link (UI-2): joins, then replaces itself
                  with /group/:groupId. */}
              <Route path="/join/:code" element={<RequireAuth><JoinByCode /></RequireAuth>} />
              <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
              {/* The personal topic library. It existed but was unreachable —
                  no route pointed at it. */}
              <Route path="/topics" element={<RequireAuth><ThemeIdeas /></RequireAuth>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Router>
      </SocketProvider>
    </UserProvider>
  )
}

export default App
