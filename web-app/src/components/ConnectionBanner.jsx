import { useEffect, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import './ConnectionBanner.css'

// Brief drops (a page load, a quick reconnect) shouldn't flash a warning.
const SHOW_AFTER_MS = 1500

/**
 * Says so when the app can't reach the server. Without it, buttons that need
 * the connection just seem not to work. On a free host that sleeps when idle,
 * the first visit can take up to a minute while the server wakes, which is
 * exactly when someone new would give up.
 */
function ConnectionBanner() {
  const { isConnected } = useSocket()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isConnected) {
      const hide = setTimeout(() => setVisible(false), 0)
      return () => clearTimeout(hide)
    }
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [isConnected])

  return (
    <div className="connection-banner-region" role="status" aria-live="polite">
      {visible && !isConnected && (
        <p className="connection-banner">
          <span className="connection-spinner" aria-hidden="true" />
          Connecting to the server… If nobody has played in a while, it can take up to a minute to wake up.
        </p>
      )}
    </div>
  )
}

export default ConnectionBanner
