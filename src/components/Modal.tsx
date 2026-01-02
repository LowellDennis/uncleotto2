import { useState } from 'react'
import type { FormEvent } from 'react'
import './Modal.css'

interface SignInModalProps {
  onClose: () => void
  onSignIn: (email: string, password: string) => Promise<{ error: any }>
}

export function SignInModal({ onClose, onSignIn }: SignInModalProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Load saved email
  useState(() => {
    const savedEmail = localStorage.getItem('uncleotto_saved_email')
    if (savedEmail) {
      setEmail(savedEmail)
    }
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await onSignIn(email, password)

    if (result.error) {
      setError(result.error.message)
      setLoading(false)
    } else {
      localStorage.setItem('uncleotto_saved_email', email)
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2 className="modal-title">Sign In</h2>
        
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-modal-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

interface CreateAccountModalProps {
  onClose: () => void
  onCreateAccount: (email: string, password: string, displayName: string, gameName: string) => Promise<{ error: any }>
}

export function CreateAccountModal({ onClose, onCreateAccount }: CreateAccountModalProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [gameName, setGameName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Load saved names
  useState(() => {
    const savedDisplayName = localStorage.getItem('uncleotto_player_name')
    if (savedDisplayName) {
      setDisplayName(savedDisplayName)
    }
    const savedGameName = localStorage.getItem('uncleotto_game_name')
    if (savedGameName) {
      setGameName(savedGameName)
    }
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      return setError('Passwords do not match')
    }

    if (password.length < 6) {
      return setError('Password must be at least 6 characters')
    }

    setLoading(true)

    const result = await onCreateAccount(email, password, displayName, gameName)

    if (result.error) {
      setError(result.error.message)
      setLoading(false)
    } else {
      localStorage.setItem('uncleotto_player_name', displayName)
      localStorage.setItem('uncleotto_game_name', gameName)
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2 className="modal-title">Create Account</h2>
        
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          <div className="form-group">
            <label htmlFor="displayName">Display Name</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name in games"
              required
              disabled={loading}
              maxLength={50}
            />
          </div>

          <div className="form-group">
            <label htmlFor="gameName">Personal Game Name</label>
            <input
              id="gameName"
              type="text"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="Your default game name"
              required
              disabled={loading}
              maxLength={50}
            />
          </div>

          <button type="submit" className="btn-modal-primary" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
