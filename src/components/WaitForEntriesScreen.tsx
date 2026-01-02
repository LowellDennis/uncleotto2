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

export const WaitForEntriesScreen: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [playersWithEntries, setPlayersWithEntries] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (!gameId) {
      navigate('/');
      return;
    }

    loadGameData();

    // Real-time subscription
    const channel = supabase
      .channel(`wait-for-entries-${gameId}`)
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
          setPlayers(prev => {
            const remainingPlayers = prev.filter(p => p.id !== deletedPlayer.id);
            
            // End game if not enough players
            if (remainingPlayers.length < 2) {
              alert('Not enough players to continue. Game ending.');
              navigate('/');
              return prev;
            }
            
            return remainingPlayers;
          });
          
          if (deletedPlayer.user_id === user?.id) {
            navigate('/');
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'entries',
          filter: `game_id=eq.${gameId}`
        },
        () => {
          // Reload entries when a new entry is added
          checkPlayerEntries();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, navigate, user?.id]);

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

      setLoading(false);
    } catch (err) {
      console.error('Error loading game data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load game data');
      setLoading(false);
    }
  };

  // Check player entries when game and players are loaded
  useEffect(() => {
    if (game && players.length > 0) {
      checkPlayerEntries();
    }
  }, [game, players.length, gameId]);

  const checkPlayerEntries = async () => {
    if (!gameId || !game || hasNavigated.current) return;

    try {
      // Get all entries for current round
      const { data: entries, error } = await supabase
        .from('entries')
        .select('player_id')
        .eq('game_id', gameId)
        .eq('round', game.current_round);

      if (error) throw error;

      // Get unique player IDs who have submitted
      const playerIds = new Set(entries?.map(e => e.player_id) || []);
      setPlayersWithEntries(playerIds);

      // Check if all players have submitted
      if (players.length > 0 && playerIds.size === players.length) {
        // All players ready - navigate to voting screen
        hasNavigated.current = true;
        navigate(`/game/${gameId}/voting`);
      }
    } catch (err) {
      console.error('Error checking player entries:', err);
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
        await supabase.from('players').delete().eq('id', currentPlayer.id);
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
    return <div className="loading">Loading game data...</div>;
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
          playersReady={playersWithEntries}
        />

        <div className="waiting-message">
          Waiting for all players to submit their entries...
        </div>
      </div>

      <Footer />
    </div>
  );
};
