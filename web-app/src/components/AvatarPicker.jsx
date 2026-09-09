import { useUser } from '../context/UserContext'
import './AvatarPicker.css'

/**
 * The one avatar picker, used by both first-time setup and the Account page,
 * so the two can't drift apart. The choices come from the server's session
 * payload — the same list it validates submissions against.
 */
function AvatarPicker({ value, onChange, labelledBy }) {
  const { avatarChoices } = useUser()

  return (
    <div
      className="avatar-grid"
      role="radiogroup"
      aria-labelledby={labelledBy}
    >
      {avatarChoices.map((avatar) => (
        <button
          key={avatar}
          type="button"
          role="radio"
          aria-checked={value === avatar}
          className={`avatar-option ${value === avatar ? 'selected' : ''}`}
          onClick={() => onChange(avatar)}
          aria-label={`Avatar ${avatar}`}
        >
          {avatar}
        </button>
      ))}
    </div>
  )
}

export default AvatarPicker
