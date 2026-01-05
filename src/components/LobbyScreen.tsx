import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GameHeader } from './GameHeader';
import { Caption } from './Caption';
import { PlayerKey } from './PlayerKey';
import { Footer } from './Footer';
import { useAuth } from '../contexts/AuthContext';
import type { Game, Player } from '../types/database.types';
import { supabase } from '../lib/supabase';
import { gameService } from '../lib/gameService';
import './LobbyScreen.css';

export const LobbyScreen: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingGame, setStartingGame] = useState(false);
  const [leavingGame, setLeavingGame] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      navigate('/');
      return;
    }

    loadGameData();
    
    // Single channel for both game and player updates
    const channel = supabase
      .channel(`lobby-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedGame = payload.new as Game;
            setGame(updatedGame);
            
            // If game started, navigate to entry screen
            if (updatedGame.status === 'in_progress') {
              navigate(`/game/${gameId}/entry`);
            }
          } else if (payload.eventType === 'DELETE') {
            // Game was ended by host - save my stats before navigating
            if (currentPlayer && user?.id) {
              gameService.updateMyStats(user.id, currentPlayer.score || 0);
            }
            
            const hostPlayer = players.find(p => p.is_host);
            const hostName = hostPlayer?.name || 'The host';
            alert(`${hostName} has ended the game!`);
            navigate('/');
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'players',
          filter: `game_id=eq.${gameId}`
        },
        (payload) => {
          const newPlayer = payload.new as Player;
          setPlayers(prev => [...prev, newPlayer].sort((a, b) => a.join_order - b.join_order));
          if (newPlayer.user_id === user?.id) {
            setCurrentPlayer(newPlayer);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'players',
          filter: `game_id=eq.${gameId}`
        },
        (payload) => {
          const updatedPlayer = payload.new as Player;
          setPlayers(prev => prev.map(p => p.id === updatedPlayer.id ? updatedPlayer : p));
          if (updatedPlayer.user_id === user?.id) {
            setCurrentPlayer(updatedPlayer);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'players',
          filter: `game_id=eq.${gameId}`
        },
        (payload) => {
          const deletedPlayer = payload.old as Player;
          setPlayers(prev => prev.filter(p => p.id !== deletedPlayer.id));
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [gameId, navigate]);

  // Reload when page becomes visible (device wakes up)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && gameId) {
        loadGameData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [gameId]);

  // Polling fallback for game status (especially important for Safari/iOS)
  useEffect(() => {
    if (!gameId) return;

    const pollInterval = setInterval(async () => {
      const { data: gameData } = await supabase
        .from('games')
        .select('status')
        .eq('id', gameId)
        .single();

      if (gameData?.status === 'in_progress') {
        navigate(`/game/${gameId}/entry`);
      }
    }, 1000); // Check every second

    return () => clearInterval(pollInterval);
  }, [gameId, navigate]);

  const loadGameData = async () => {
    if (!gameId) return;

    try {
      // Load game and players in parallel
      const [gameResult, playersResult] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).single(),
        supabase.from('players').select('*').eq('game_id', gameId).order('join_order', { ascending: true })
      ]);

      if (gameResult.error) throw gameResult.error;
      if (!gameResult.data) {
        setError('Game not found');
        setTimeout(() => navigate('/'), 2000);
        return;
      }

      setGame(gameResult.data);
      
      if (playersResult.error) throw playersResult.error;
      const loadedPlayers = playersResult.data || [];
      setPlayers(loadedPlayers);
      
      // Check if there's a host
      const hasHost = loadedPlayers.some(p => p.is_host);
      
      // If no host exists and there are players, auto-assign first player as host
      if (!hasHost && loadedPlayers.length > 0) {
        const newHost = loadedPlayers[0];
        
        // Update the first player to be the host
        const { error: updateError } = await supabase
          .from('players')
          .update({ is_host: true })
          .eq('id', newHost.id);
        
        if (!updateError) {
          // Update local state
          const updatedPlayers = loadedPlayers.map(p => 
            p.id === newHost.id ? { ...p, is_host: true } : p
          );
          setPlayers(updatedPlayers);
          
          // Show message to all players
          const message = newHost.user_id === user?.id
            ? `The previous host left. You are now the host!`
            : `The previous host left. ${newHost.name} is now the host.`;
          alert(message);
          
          // Update currentPlayer if it's the new host
          if (newHost.user_id === user?.id) {
            setCurrentPlayer({ ...newHost, is_host: true });
          }
        }
      } else {
        const current = loadedPlayers.find(p => p.user_id === user?.id);
        setCurrentPlayer(current || null);
      }
      
      setLoading(false);
    } catch (err) {
      setError('Failed to load game');
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    const isHost = currentPlayer?.is_host || user?.id === game?.host_id;
    
    if (!gameId || !game || !isHost) {
      return;
    }
    
    if (players.length < 2) {
      setError('Need at least 2 players to start');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setStartingGame(true);
    try {
      const { error } = await gameService.startGame(gameId);
      if (error) {
        throw error;
      }
      // Navigation will happen automatically via realtime subscription or polling
    } catch (err) {
      setError('Failed to start game');
      setTimeout(() => setError(null), 3000);
      setStartingGame(false);
    }
  };

  const handleLeaveGame = async () => {
    if (!gameId || !currentPlayer) return;

    const message = players.length === 2
      ? 'If you leave the game there will not be enough to continue. Are you sure?'
      : 'Are you sure you want to leave this game?';

    if (!confirm(message)) {
      return;
    }

    setLeavingGame(true);
    try {
      await gameService.leaveGame(gameId, currentPlayer.id);
      navigate('/');
    } catch (err) {
      setError('Failed to leave game');
      setTimeout(() => setError(null), 3000);
      setLeavingGame(false);
    }
  };

  const handleEndGame = async () => {
    const isHost = currentPlayer?.is_host || user?.id === game?.host_id;
    
    if (!gameId || !game || !isHost) {
      return;
    }

    if (!confirm('Are you sure you want to end the game?')) {
      return;
    }

    setLeavingGame(true);
    try {
      const result = await gameService.deleteGame(gameId);
      if (result.error) {
        throw result.error;
      }
      navigate('/');
    } catch (err) {
      setError('Failed to end game: ' + (err as any).message);
      setTimeout(() => setError(null), 5000);
      setLeavingGame(false);
    }
  };

  const handleKickPlayer = async (playerId: string) => {
    const isHost = currentPlayer?.is_host || user?.id === game?.host_id;
    
    if (!gameId || !isHost) {
      return;
    }

    try {
      // If only 2 players, kicking one will end the game
      if (players.length === 2) {
        const result = await gameService.deleteGame(gameId);
        if (result.error) {
          throw result.error;
        }
        navigate('/');
      } else {
        const result = await gameService.leaveGame(gameId, playerId);
        if (result.error) {
          throw result.error;
        }
      }
    } catch (err) {
      setError('Failed to kick player');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleTakeOverHost = async () => {
    if (!gameId || !currentPlayer || !user?.id) return;

    const currentHost = players.find(p => p.is_host);
    if (!currentHost) return;

    const message = `The host (${currentHost.name}) appears to be inactive. Do you want to take over as host?`;
    
    if (!confirm(message)) {
      return;
    }

    try {
      // Update game's host_id
      await supabase
        .from('games')
        .update({ host_id: user.id })
        .eq('id', gameId);

      // Remove host from old host
      await supabase
        .from('players')
        .update({ is_host: false })
        .eq('id', currentHost.id);

      // Make current player the host
      const { error } = await supabase
        .from('players')
        .update({ is_host: true })
        .eq('id', currentPlayer.id);

      if (error) throw error;

      // Update local state
      setPlayers(prev => prev.map(p => 
        p.id === currentPlayer.id ? { ...p, is_host: true } :
        p.id === currentHost.id ? { ...p, is_host: false } : p
      ));
      setCurrentPlayer({ ...currentPlayer, is_host: true });

      alert(`You are now the host!`);
    } catch (err) {
      setError('Failed to take over as host');
      setTimeout(() => setError(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="lobby-screen">
        <GameHeader />
        <div className="lobby-content">
          <div className="loading">Loading lobby...</div>
        </div>
        <Footer />
      </div>
    );
  }

  if (error && !game) {
    return (
      <div className="lobby-screen">
        <GameHeader />
        <div className="lobby-content">
          <div className="error-message">{error}</div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="lobby-screen">
        <GameHeader />
        <div className="lobby-content">
          <div className="loading">Loading game...</div>
        </div>
        <Footer />
      </div>
    );
  }

  // Find player to display in caption (either currentPlayer or any player matching user ID)
  const displayPlayer = currentPlayer || players.find(p => p.user_id === user?.id);

  return (
    <div className="lobby-screen">
      <GameHeader />
      
      <Caption 
        message={
          displayPlayer ? (
            <><span style={{ color: displayPlayer.color, fontWeight: 'bold' }}>{displayPlayer.name}</span> playing game <strong>{game.name}</strong></>
          ) : (
            <>Viewing game <strong>{game.name}</strong></>
          )
        }
        button={
          displayPlayer ? (
            displayPlayer.is_host || user?.id === game.host_id ? (
              <button 
                className="btn-caption"
                onClick={handleEndGame}
                disabled={leavingGame}
              >
                {leavingGame ? 'Ending...' : 'End Game'}
              </button>
            ) : (
              <button 
                className="btn-caption"
                onClick={handleLeaveGame}
                disabled={leavingGame}
              >
                {leavingGame ? 'Leaving...' : 'Leave Game'}
              </button>
            )
          ) : undefined
        }
      />

      <div className="lobby-content">
        {error && <div className="error-message">{error}</div>}
        
        {players.length > 0 ? (
          <>
            <PlayerKey 
              players={players}
              currentUserId={user?.id}
              showKickButton={currentPlayer?.is_host || user?.id === game.host_id}
              onKickPlayer={handleKickPlayer}
              onTakeOverHost={!currentPlayer?.is_host && currentPlayer ? handleTakeOverHost : undefined}
              showLifetimeScore={true}
            />
            <p style={{ textAlign: 'center', fontSize: '0.85em', color: '#666', marginTop: '8px', marginBottom: '16px' }}>
              Scores shown are lifetime scores
            </p>
          </>
        ) : (
          <div className="loading">Loading players...</div>
        )}

        {(currentPlayer?.is_host || user?.id === game.host_id) && (
          <div className="lobby-actions">
            <button 
              className="start-button"
              onClick={handleStartGame}
              disabled={players.length < 2 || startingGame}
            >
              {startingGame ? 'Starting...' : players.length < 2 ? 'Need at least 2' : 'Start Game'}
            </button>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
};
