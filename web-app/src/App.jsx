import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { SocketProvider } from './context/SocketContext'
import { UserProvider } from './context/UserContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CreateGroup from './pages/CreateGroup'
import GroupView from './pages/GroupView'
import Account from './pages/Account'
import './App.css'

function App() {
  return (
    <UserProvider>
      <SocketProvider>
        <Router>
          <div className="app">
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/create-group" element={<CreateGroup />} />
              <Route path="/group/:groupId" element={<GroupView />} />
              <Route path="/account" element={<Account />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Router>
      </SocketProvider>
    </UserProvider>
  )
}

export default App
