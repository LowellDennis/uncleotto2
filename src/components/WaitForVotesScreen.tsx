import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GameHeader } from './GameHeader';
import { Caption } from './Caption';
import { PlayerKey } from './PlayerKey';
import { Footer } from './Footer';
import { useAuth } from '../contexts/AuthContext';
import type { Game, Player } from '../types/database.types';
import { supabase } from '../lib/supabase';
import { gameService } from '../lib/gameService';
import './WaitForEntriesScreen.css';

export const WaitForVotesScreen: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [playersReady, setPlayersReady] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (!gameId) {
      navigate('/');
      return;
    }

    // Mark current player as ready immediately
    markPlayerReady();
    loadGameData();

    // Real-time subscription
    const channel = supabase
      .channel(`wait-for-votes-${gameId}`)
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
            setGame(payload.new as Game);
          } else if (payload.eventType === 'DELETE') {
            // Game was ended by host
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
          const remainingPlayers = players.filter(p => p.id !== deletedPlayer.id);
          setPlayers(remainingPlayers);
          
          // End game if not enough players
          if (remainingPlayers.length < 2) {
            alert('Not enough players to continue. Game ending.');
            navigate('/');
            return;
          }
          
          if (deletedPlayer.user_id === user?.id) {
            navigate('/');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, navigate, user?.id]);

  // Check if all players are ready and navigate to next round
  useEffect(() => {
    if (!game || !players.length || hasNavigated.current) return;

    const allReady = players.every(p => p.ready);
    
    if (allReady) {
      hasNavigated.current = true;
      
      // Only host increments round and resets ready state
      if (currentPlayer?.is_host) {
        incrementRoundAndResetPlayers();
      } else {
        // Non-host players just wait for the navigation
        setTimeout(() => {
          navigate(`/game/${gameId}/entry`);
        }, 1000);
      }
    }
  }, [players, game, gameId, navigate, currentPlayer]);

  const incrementRoundAndResetPlayers = async () => {
    if (!game || !gameId) return;

    try {
      // Increment round
      const { error: gameError } = await supabase
        .from('games')
        .update({ current_round: game.current_round + 1 })
        .eq('id', gameId);

      if (gameError) throw gameError;

      // Reset all players' ready state
      const { error: playersError } = await supabase
        .from('players')
        .update({ ready: false })
        .eq('game_id', gameId);

      if (playersError) throw playersError;

      // Navigate to entry screen for next round
      setTimeout(() => {
        navigate(`/game/${gameId}/entry`);
      }, 1000);
    } catch (err) {
      console.error('Error starting next round:', err);
      setError(err instanceof Error ? err.message : 'Failed to start next round');
    }
  };

  const markPlayerReady = async () => {
    if (!user?.id || !gameId) return;

    try {
      // Find current player
      const { data: playersData } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameId)
        .eq('user_id', user.id);

      if (playersData && playersData.length > 0) {
        const player = playersData[0];
        
        // Mark as ready
        await supabase
          .from('players')
          .update({ ready: true })
          .eq('id', player.id);
      }
    } catch (err) {
      console.error('Error marking player ready:', err);
    }
  };

  const loadGameData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!gameId) return;

      const { data: gameData, error: gameError } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .single();

      if (gameError) throw gameError;
      if (!gameData) {
        navigate('/');
        return;
      }

      setGame(gameData);

      const { data: playersData, error: playersError } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameId)
        .order('join_order');

      if (playersError) throw playersError;

      setPlayers(playersData || []);
      const player = playersData?.find(p => p.user_id === user?.id) || null;
      setCurrentPlayer(player);

      // Track which players are ready
      const ready = new Set(
        playersData?.filter(p => p.ready).map(p => p.id) || []
      );
      setPlayersReady(ready);
    } catch (err) {
      console.error('Error loading game data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load game data');
    } finally {
      setLoading(false);
    }
  };

  const handleEndGame = async () => {
    if (!game) return;
    
    if (confirm('Are you sure you want to end this game? This will save all players\' lifetime scores and return everyone to the lobby.')) {
      try {
        await gameService.deleteGame(game.id);
        navigate('/');
      } catch (err) {
        console.error('Error ending game:', err);
        setError(err instanceof Error ? err.message : 'Failed to end game');
      }
    }
  };

  const handleLeaveGame = async () => {
    if (!currentPlayer) return;
    
    if (confirm('Are you sure you want to leave this game?')) {
      try {
        await gameService.removePlayer(currentPlayer.id);
        navigate('/');
      } catch (err) {
        console.error('Error leaving game:', err);
        setError(err instanceof Error ? err.message : 'Failed to leave game');
      }
    }
  };
  const handleKickPlayer = async (playerId: string) => {
    if (!gameId || !currentPlayer?.is_host) return;

    try {
      // If only 2 players, kicking one will end the game
      if (players.length === 2) {
        await gameService.deleteGame(gameId);
      } else {
        await gameService.leaveGame(gameId, playerId);
      }
    } catch (err) {
      console.error('Error kicking player:', err);
      setError(err instanceof Error ? err.message : 'Failed to kick player');
    }
  };
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  if (!game) {
    return <div className="error-message">Game not found</div>;
  }

  const displayPlayer = currentPlayer || players.find(p => p.user_id === user?.id);

  return (
    <div className="waiting-screen">
      <GameHeader />
      
      <div className="waiting-content">
        <Caption
          message={
            displayPlayer ? (
              <>
                <span style={{ color: displayPlayer.color, fontWeight: 'bold' }}>
                  {displayPlayer.name}
                </span>
                {' playing game '}
                <span style={{ fontWeight: 'bold' }}>{game.name}</span>
              </>
            ) : (
              <>Viewing game <span style={{ fontWeight: 'bold' }}>{game.name}</span></>
            )
          }
          button={
            currentPlayer?.is_host || user?.id === game.host_id ? (
              <button onClick={handleEndGame} className="btn-caption">
                End Game
              </button>
            ) : (
              <button onClick={handleLeaveGame} className="btn-caption">
                Leave Game
              </button>
            )
          }
        />

        <PlayerKey
          players={players}
          currentUserId={user?.id}
          showKickButton={currentPlayer?.is_host || false}
          onKickPlayer={handleKickPlayer}
          playersReady={playersReady}
        />

        <div className="waiting-message">
          Waiting for all players to finish voting...
        </div>
      </div>

      <Footer />
    </div>
  );
};
