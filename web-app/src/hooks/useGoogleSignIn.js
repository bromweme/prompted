import { useEffect, useRef, useState } from 'react'

const GSI_SRC = 'https://accounts.google.com/gsi/client'

// Loads the Google Identity Services script once per page, no matter how many
// components ask for it.
let gsiPromise = null
function loadGsi() {
  if (gsiPromise) return gsiPromise

  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google)
      return
    }

    const existing = document.querySelector(`script[src="${GSI_SRC}"]`)
    const script = existing || document.createElement('script')

    script.addEventListener('load', () => resolve(window.google))
    script.addEventListener('error', () => reject(new Error('Could not load Google Sign-In')))

    if (!existing) {
      script.src = GSI_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })

  return gsiPromise
}

/**
 * Renders Google's own sign-in button into `buttonRef` and hands the returned
 * ID token to `onCredential`. The token is verified server-side — nothing here
 * treats it as proof of anything on its own.
 *
 * Returns { status, error } where status is 'disabled' (no client id
 * configured), 'loading', 'ready' or 'error', so the caller can explain what
 * is going on instead of showing a button that will never work.
 */
export function useGoogleSignIn(onCredential) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const buttonRef = useRef(null)
  const [status, setStatus] = useState(clientId ? 'loading' : 'disabled')
  const [error, setError] = useState(null)

  // Kept in a ref so re-rendering the parent doesn't re-initialise GSI.
  const onCredentialRef = useRef(onCredential)
  onCredentialRef.current = onCredential

  useEffect(() => {
    if (!clientId) return undefined

    let cancelled = false

    loadGsi()
      .then((google) => {
        if (cancelled || !buttonRef.current) return

        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => onCredentialRef.current(credential)
        })

        google.accounts.id.renderButton(buttonRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 280
        })

        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setError(err.message)
      })

    return () => {
      cancelled = true
    }
  }, [clientId])

  return { buttonRef, status, error }
}
