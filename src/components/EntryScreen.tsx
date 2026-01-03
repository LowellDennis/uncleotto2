import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GameHeader } from './GameHeader';
import { Caption } from './Caption';
import { PlayerKey } from './PlayerKey';
import { EntryField } from './EntryField';
import { Footer } from './Footer';
import { useAuth } from '../contexts/AuthContext';
import type { Game, Player } from '../types/database.types';
import { supabase } from '../lib/supabase';
import { gameService } from '../lib/gameService';
import './EntryScreen.css';

interface EntryInputs {
  title: string;
  name: string;
  verb: string;
  adverb: string;
  preposition: string;
  noun: string;
}

const MAX_CHARS = 1024;

export const EntryScreen: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameDeleted = useRef(false);
  
  // Initialize entries from localStorage if available
  const [entries, setEntries] = useState<EntryInputs>(() => {
    const storageKey = `entries-${gameId}-${user?.id}`;
    
    if (!gameId || !user?.id) {
      return {
        title: '',
        name: '',
        verb: '',
        adverb: '',
        preposition: '',
        noun: ''
      };
    }
    
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return {
          title: '',
          name: '',
          verb: '',
          adverb: '',
          preposition: '',
          noun: ''
        };
      }
    }
    
    return {
      title: '',
      name: '',
      verb: '',
      adverb: '',
      preposition: '',
      noun: ''
    };
  });

  // Load from localStorage when user ID becomes available
  useEffect(() => {
    if (gameId && user?.id) {
      const storageKey = `entries-${gameId}-${user?.id}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          setEntries(JSON.parse(stored));
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, [gameId, user?.id]);

  useEffect(() => {
    if (!gameId) {
      navigate('/');
      return;
    }

    loadGameData();

    // Real-time subscription
    const channel = supabase
      .channel(`entry-${gameId}`)
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
            gameDeleted.current = true;
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
          
          // End game if not enough players (skip if game was already deleted by host)
          if (remainingPlayers.length < 2) {
            if (!gameDeleted.current) {
              alert('Not enough players to continue. Game ending.');
            }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game data');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof EntryInputs, value: string) => {
    if (value.length <= MAX_CHARS) {
      const newEntries = { ...entries, [field]: value };
      setEntries(newEntries);
      // Save to localStorage
      if (gameId && user?.id) {
        const storageKey = `entries-${gameId}-${user?.id}`;
        localStorage.setItem(storageKey, JSON.stringify(newEntries));
      }
    }
  };

  const allFieldsFilled = () => {
    return Object.values(entries).every(value => value.trim().length > 0);
  };

  const handleSubmit = async () => {
    if (!currentPlayer || !game) return;

    try {
      setSubmitting(true);
      setError(null);

      // Save all entries to database
      const entryRecords = [
        { category: 'title' as const, text: entries.title },
        { category: 'name' as const, text: entries.name },
        { category: 'verb' as const, text: entries.verb },
        { category: 'adverb' as const, text: entries.adverb },
        { category: 'preposition' as const, text: entries.preposition },
        { category: 'noun' as const, text: entries.noun }
      ];

      for (const entry of entryRecords) {
        const { error: insertError } = await supabase
          .from('entries')
          .insert({
            game_id: game.id,
            player_id: currentPlayer.id,
            round: game.current_round,
            category: entry.category,
            text: entry.text.trim()
          });

        if (insertError) throw insertError;
      }

      // Clear localStorage after successful submission
      if (gameId && user?.id) {
        const storageKey = `entries-${gameId}-${user?.id}`;
        localStorage.removeItem(storageKey);
      }

      // Navigate to waiting screen
      navigate(`/game/${gameId}/waiting`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit entries');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndGame = async () => {
    if (!game) return;
    
    if (confirm('Are you sure you want to end this game? This will save all players\' lifetime scores and return everyone to the lobby.')) {
      try {
        await gameService.deleteGame(game.id);
        navigate('/');
      } catch (err) {
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
    <div className="entry-screen">
      <GameHeader />
      
      <div className="entry-content">
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
        />

        <div className="round-indicator">Round {game.current_round}</div>

        <div className="entry-form">
          <EntryField
            id="title"
            label="Uncle"
            value={entries.title}
            placeholder="A title"
            maxChars={MAX_CHARS}
            onChange={(value) => handleInputChange('title', value)}
          />
          
          <EntryField
            id="name"
            label="Otto"
            value={entries.name}
            placeholder="A name"
            maxChars={MAX_CHARS}
            onChange={(value) => handleInputChange('name', value)}
          />
          
          <EntryField
            id="verb"
            label="Splashes"
            value={entries.verb}
            placeholder="An active verb"
            maxChars={MAX_CHARS}
            onChange={(value) => handleInputChange('verb', value)}
          />
          
          <EntryField
            id="adverb"
            label="Happily"
            value={entries.adverb}
            placeholder="An adverb"
            maxChars={MAX_CHARS}
            onChange={(value) => handleInputChange('adverb', value)}
          />
          
          <EntryField
            id="preposition"
            label="In the"
            value={entries.preposition}
            placeholder="A preposition"
            maxChars={MAX_CHARS}
            onChange={(value) => handleInputChange('preposition', value)}
          />
          
          <EntryField
            id="noun"
            label="Bathtub"
            value={entries.noun}
            placeholder="A noun"
            maxChars={MAX_CHARS}
            onChange={(value) => handleInputChange('noun', value)}
          />
        </div>

        <div className="entry-actions">
          <button
            onClick={handleSubmit}
            disabled={!allFieldsFilled() || submitting}
            className="submit-button"
          >
            {submitting ? 'Submitting...' : 'Submit Entries'}
          </button>
        </div>
      </div>

      <Footer />
    </div>
  );
};
