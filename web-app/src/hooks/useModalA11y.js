import { useEffect } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Shared modal accessibility behavior: focuses the first interactive element
// when a modal opens, traps Tab/Shift+Tab focus inside it, closes on
// Escape, and restores focus to the trigger element on close.
//
// Passing no onClose makes the modal non-dismissable: focus is still trapped
// and managed, but Escape does nothing. Used by first-time profile setup,
// where dismissing would just reopen it on the next load.
export function useModalA11y(isOpen, containerRef, onClose) {
  useEffect(() => {
    if (!isOpen) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement
    const focusables = container.querySelectorAll(FOCUSABLE_SELECTOR)
    // Prefer the first focusable control that isn't the close button, so
    // e.g. a form's first field gets focus rather than the "×" in the corner.
    const initialTarget = [...focusables].find((el) => !el.classList.contains('close-button')) || focusables[0]
    initialTarget?.focus()

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (onClose) onClose()
        return
      }
      if (e.key !== 'Tab') return

      const current = container.querySelectorAll(FOCUSABLE_SELECTOR)
      if (current.length === 0) return
      const first = current[0]
      const last = current[current.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [isOpen, containerRef, onClose])
}
