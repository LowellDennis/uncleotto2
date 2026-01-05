import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { GameHeader } from './GameHeader'
import { Caption } from './Caption'
import { SignInModal, CreateAccountModal } from './Modal'
import { Footer } from './Footer'
import { gameService } from '../lib/gameService'
import type { Game } from '../types/database.types'
import './GatheringScreen.css'

export function GatheringScreen() {
  const [playerName, setPlayerName] = useState('')
  const [gameName, setGameName] = useState('')
  const [availableGames, setAvailableGames] = useState<Game[]>([])
  const [showSignInModal, setShowSignInModal] = useState(false)
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showUpdateMetadata, setShowUpdateMetadata] = useState(false)
  const navigate = useNavigate()
  const { user, isAnonymous, signInAnonymously, signIn, signUp, signOut, updateUserMetadata } = useAuth()

  const handlePlayAsGuest = async () => {
    if (!user) {
      await signInAnonymously()
    }
  }

  // Load saved player name on mount
  useEffect(() => {
    const savedName = localStorage.getItem('uncleotto_player_name')
    if (savedName) {
      setPlayerName(savedName)
    }

    const savedGameName = localStorage.getItem('uncleotto_game_name')
    if (savedGameName) {
      setGameName(savedGameName)
    }
  }, [])

  // Load available games and subscribe to changes
  useEffect(() => {
    // Load initial games
    const loadGames = async () => {
      const { games } = await gameService.getAvailableGames()
      console.log('Loaded games:', games.length, games.map(g => ({id: g.id, name: g.name})));
      setAvailableGames(games)
    }
    loadGames();

    // Subscribe to incremental real-time updates
    const channel = gameService.subscribeToGames(
      // On INSERT
      (newGame) => {
        if (newGame.status === 'waiting') {
          setAvailableGames(prev => [...prev, newGame].sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          ));
        }
      },
      // On UPDATE
      (updatedGame) => {
        if (updatedGame.status === 'waiting') {
          setAvailableGames(prev => prev.map(g => g.id === updatedGame.id ? updatedGame : g));
        } else {
          setAvailableGames(prev => prev.filter(g => g.id !== updatedGame.id));
        }
      },
      // On DELETE
      (gameId) => {
        setAvailableGames(prev => prev.filter(g => g.id !== gameId));
      }
    );

    // Reload games when page becomes visible (device wakes up)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadGames();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Polling fallback for mobile devices (every 5 seconds)
    const pollInterval = setInterval(() => {
      loadGames();
    }, 5000);

    return () => {
      channel.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(pollInterval);
    };
  }, [])

  // Auto-fill player name from user metadata when user signs in
  useEffect(() => {
    if (user) {
      if (!isAnonymous) {
        // For authenticated users, prioritize user metadata
        const displayName = user.user_metadata?.display_name
        const userGameName = user.user_metadata?.game_name
        
        if (displayName) {
          setPlayerName(displayName)
          localStorage.setItem('uncleotto_player_name', displayName)
        }
        if (userGameName) {
          setGameName(userGameName)
          localStorage.setItem('uncleotto_game_name', userGameName)
        }
      }
      // For guests, the localStorage values from initial mount will remain
    }
  }, [user, isAnonymous])

  // Check if metadata needs updating
  useEffect(() => {
    if (user && !isAnonymous && (playerName || gameName)) {
      const savedDisplayName = user.user_metadata?.display_name || ''
      const savedGameName = user.user_metadata?.game_name || ''
      
      // Show update button if values differ or are missing
      if ((playerName && playerName !== savedDisplayName) || 
          (gameName && gameName !== savedGameName) ||
          (!savedDisplayName && playerName) ||
          (!savedGameName && gameName)) {
        setShowUpdateMetadata(true)
      } else {
        setShowUpdateMetadata(false)
      }
    } else {
      setShowUpdateMetadata(false)
    }
  }, [user, isAnonymous, playerName, gameName])

  const handleUpdateMetadata = async () => {
    if (!user || isAnonymous) return
    
    const { error } = await updateUserMetadata(playerName, gameName)
    if (error) {
      alert('Failed to update profile')
    } else {
      setShowUpdateMetadata(false)
    }
  }

  const handleGameNameChange = (name: string) => {
    setGameName(name)
    // Auto-save game name
    localStorage.setItem('uncleotto_game_name', name)
  }

  const handleSignInSubmit = async (email: string, password: string) => {
    return await signIn(email, password)
  }

  const handleCreateAccountSubmit = async (email: string, password: string, displayName: string, gameNameValue: string) => {
    setPlayerName(displayName)
    setGameName(gameNameValue)
    const result = await signUp(email, password, displayName, gameNameValue)
    
    // Show email validation message if signup succeeded
    if (!result.error) {
      alert('Account created! Please check your email for a validation link to activate your account.');
    }
    
    return result
  }

  const handleLogOut = async () => {
    await signOut()
    // Clear local state
    setPlayerName('')
    setGameName('')
  }

  const handleCreateGame = async () => {
    if (!user) return
    
    // Check if game name already exists
    const gameExists = availableGames.some(game => game.name.toLowerCase() === gameName.toLowerCase())
    if (gameExists) {
      alert('A game with this name already exists. Please choose a different name.')
      return
    }

    setLoading(true)
    const { game, error } = await gameService.createGame(gameName, playerName, user.id)
    setLoading(false)

    if (error) {
      alert('Failed to create game. Please try again.')
      return
    }

    if (game) {
      // Navigate to lobby
      navigate(`/lobby/${game.id}`)
    }
  }

  const handleJoinGame = async (gameId: string) => {
    if (!user) return

    setLoading(true)
    const { player, error } = await gameService.joinGame(gameId, playerName, user.id)
    setLoading(false)

    if (error) {
      alert(error.message || 'Failed to join game. Please try again.')
      return
    }

    if (player) {
      // Navigate to lobby
      navigate(`/lobby/${gameId}`)
    }
  }

  const isCreateGameDisabled = !playerName.trim() || !gameName.trim()
  const isJoinGameDisabled = !playerName.trim()

  return (
    <div className="gathering-screen">
      <GameHeader />
      
      {!user ? (
        <div className="auth-selection">
          <div className="auth-buttons">
            <button onClick={() => setShowSignInModal(true)} className="btn-auth">
              Sign In
            </button>
            <button onClick={() => setShowCreateAccountModal(true)} className="btn-auth">
              Create Account
            </button>
            <button onClick={handlePlayAsGuest} className="btn-auth btn-auth-primary">
              Play As Guest
            </button>
          </div>
        </div>
      ) : (
        <>
          <Caption 
            message={
              isAnonymous ? (
                <>Logged in as <strong>Guest</strong></>
              ) : (
                <>Logged in as <strong>{user.email}</strong></>
              )
            }
            button={
              <button onClick={handleLogOut} className="btn-caption">Log Out</button>
            }
          />
          
          <div className="gathering-content">
        <div className="player-section">
          <div className="input-inline">
            <label htmlFor="playerName" className="input-label">Name</label>
            <input
              id="playerName"
              type="text"
              className="text-input"
              value={playerName}
              onChange={(e) => {
                const name = e.target.value
                setPlayerName(name)
                // Auto-save player name
                localStorage.setItem('uncleotto_player_name', name)
              }}
              placeholder="Enter your name"
              maxLength={50}
            />
          </div>
          <div className="input-inline">
            <label htmlFor="gameName" className="input-label">Game</label>
            <input
              id="gameName"
              type="text"
              className="text-input"
              value={gameName}
              onChange={(e) => handleGameNameChange(e.target.value)}
              placeholder="Enter game name"
              maxLength={50}
            />
          </div>
          <div className="button-row">
            {showUpdateMetadata && (
              <button
                className="btn-normal"
                onClick={handleUpdateMetadata}
              >
                Update Profile
              </button>
            )}
            <button
              className="btn-normal"
              onClick={handleCreateGame}
              disabled={isCreateGameDisabled || loading}
            >
              {loading ? 'Creating...' : 'Create Game'}
            </button>
          </div>
        </div>

        <div className="available-games-section">
          <h2 className="section-title">Available Games</h2>
          {availableGames.length === 0 ? (
            <p className="no-games">No games available. Create one to get started!</p>
          ) : (
            <div className="games-list">
              {availableGames.map((game) => (
                <div key={game.id} className="game-row">
                  <div className="game-info">
                    <span className="player-count">{game.player_count}/6</span>
                    <span className="game-name">{game.name}</span>
                  </div>
                  <button
                    className="btn-normal btn-small"
                    onClick={() => handleJoinGame(game.id)}
                    disabled={isJoinGameDisabled || game.player_count >= game.max_players || loading}
                  >
                    {loading ? 'Joining...' : 'Join Game'}
                  </button>
                </div>
              ))}
            </div>
          )}  
        </div>
      </div>
      </>
      )}

      {showSignInModal && (
        <SignInModal
          onClose={() => setShowSignInModal(false)}
          onSignIn={handleSignInSubmit}
        />
      )}

      {showCreateAccountModal && (
        <CreateAccountModal
          onClose={() => setShowCreateAccountModal(false)}
          onCreateAccount={handleCreateAccountSubmit}
        />
      )}

      <Footer />
    </div>
  )
}
