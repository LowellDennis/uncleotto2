import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GameHeader } from './GameHeader';
import { Caption } from './Caption';
import { PlayerKey } from './PlayerKey';
import { Footer } from './Footer';
import { useAuth } from '../contexts/AuthContext';
import type { Game, Player, Entry } from '../types/database.types';
import { supabase } from '../lib/supabase';
import { gameService } from '../lib/gameService';
import './VotingScreen.css';

interface WordEntry extends Entry {
  playerColor: string;
  playerName: string;
}

interface Sentence {
  id: number;
  title: WordEntry;
  name: WordEntry;
  verb: WordEntry;
  adverb: WordEntry;
  preposition: WordEntry;
  noun: WordEntry;
}

export const VotingScreen: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [votedEntries, setVotedEntries] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      navigate('/');
      return;
    }

    loadGameData();

    // Real-time subscription
    const channel = supabase
      .channel(`voting-${gameId}`)
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
          setPlayers(prev => prev.map(p => 
            p.id === updatedPlayer.id ? updatedPlayer : p
          ));
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

      // Reset all scores to 0 at the start of voting
      let resetPlayers = playersData || [];
      if (resetPlayers.length > 0) {
        await Promise.all(
          resetPlayers.map(p => 
            supabase
              .from('players')
              .update({ score: 0 })
              .eq('id', p.id)
          )
        );
        // Update local state with reset scores
        resetPlayers = resetPlayers.map(p => ({ ...p, score: 0 }));
      }

      setPlayers(resetPlayers);
      const player = resetPlayers.find(p => p.user_id === user?.id) || null;
      setCurrentPlayer(player);

      // Load entries and generate sentences
      await loadEntriesAndGenerateSentences(gameData, resetPlayers);
    } catch (err) {
      console.error('Error loading game data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load game data');
    } finally {
      setLoading(false);
    }
  };

  const loadEntriesAndGenerateSentences = async (gameData: Game, playersData: Player[]) => {
    try {
      const { data: entriesData, error: entriesError } = await supabase
        .from('entries')
        .select('*')
        .eq('game_id', gameData.id)
        .eq('round', gameData.current_round)
        .order('category', { ascending: true })
        .order('player_id', { ascending: true });

      if (entriesError) throw entriesError;

      if (!entriesData || entriesData.length === 0) {
        setError('No entries found for this round');
        return;
      }

      // Map entries to include player info
      const entriesWithPlayerInfo = entriesData.map(entry => {
        const player = playersData.find(p => p.id === entry.player_id);
        return {
          ...entry,
          playerColor: player?.color || '#cccccc',
          playerName: player?.name || 'Unknown'
        } as WordEntry;
      });

      // Generate sentences
      const generatedSentences = generateSentences(entriesWithPlayerInfo, playersData);
      setSentences(generatedSentences);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entries');
    }
  };

  const generateSentences = (entries: WordEntry[], players: Player[]): Sentence[] => {
    const categories = ['title', 'name', 'verb', 'adverb', 'preposition', 'noun'] as const;
    const sentences: Sentence[] = [];

    // Group entries by category
    const entriesByCategory: Record<string, WordEntry[]> = {
      title: [],
      name: [],
      verb: [],
      adverb: [],
      preposition: [],
      noun: []
    };

    entries.forEach(entry => {
      if (entriesByCategory[entry.category]) {
        entriesByCategory[entry.category].push(entry);
      }
    });

    // Create one sentence per player
    for (let i = 0; i < players.length; i++) {
      const sentence: any = { id: i };
      
      categories.forEach((category, categoryIndex) => {
        const categoryEntries = entriesByCategory[category];
        if (categoryEntries && categoryEntries.length > 0) {
          // Rotate through entries to distribute them
          const index = (i + categoryIndex) % categoryEntries.length;
          sentence[category] = categoryEntries[index];
        }
      });

      sentences.push(sentence as Sentence);
    }

    return sentences;
  };

  const handleWordClick = async (entry: WordEntry) => {
    if (!currentPlayer) return;
    
    // Can't vote for your own entries
    if (entry.player_id === currentPlayer.id) return;

    try {
      const isVoted = votedEntries.has(entry.id);
      
      if (isVoted) {
        // Remove vote - decrement score
        const player = players.find(p => p.id === entry.player_id);
        if (player) {
          const newScore = Math.max(0, player.score - 1);
          const { error } = await supabase
            .from('players')
            .update({ score: newScore })
            .eq('id', entry.player_id);
          
          if (error) {
            return;
          }
          
          // Update local state immediately
          setPlayers(prev => prev.map(p => 
            p.id === entry.player_id ? { ...p, score: newScore } : p
          ));
        }
        
        const newVotedEntries = new Set(votedEntries);
        newVotedEntries.delete(entry.id);
        setVotedEntries(newVotedEntries);
      } else {
        // Add vote - increment score
        const player = players.find(p => p.id === entry.player_id);
        if (player) {
          const newScore = player.score + 1;
          
          // Update database
          const { error } = await supabase
            .from('players')
            .update({ score: newScore })
            .eq('id', entry.player_id);
          
          if (error) {
            return;
          }
          
          // Update local state immediately
          setPlayers(prev => prev.map(p => 
            p.id === entry.player_id ? { ...p, score: newScore } : p
          ));
        }
        
        const newVotedEntries = new Set(votedEntries);
        newVotedEntries.add(entry.id);
        setVotedEntries(newVotedEntries);
      }
    } catch (err) {
    }
  };

  const handleDoneVoting = async () => {
    if (!currentPlayer || !game) return;

    try {
      setLoading(true);
      setError(null);

      // Navigate to results waiting screen
      navigate(`/game/${gameId}/results-waiting`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finish voting');
    } finally {
      setLoading(false);
    }
  };

  const handleEndGame = async () => {
    if (!game) return;
    
    if (confirm('Are you sure you want to end the game?')) {
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
    return <div className="loading">Loading voting...</div>;
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  if (!game) {
    return <div className="error-message">Game not found</div>;
  }

  const displayPlayer = currentPlayer || players.find(p => p.user_id === user?.id);

  return (
    <div className="voting-screen">
      <GameHeader />
      
      <div className="voting-content">
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

        <div className="sentences-container">
          <div className="voting-instructions">
            Click on entries you like (except you own) to vote for them!
          </div>
          
          {sentences.map((sentence) => (
            <div key={sentence.id} className="sentence">
              {['title', 'name', 'verb', 'adverb', 'preposition', 'noun'].map((category) => {
                const entry = sentence[category as keyof Sentence] as WordEntry;
                if (!entry) return null;
                
                const isOwnEntry = currentPlayer && entry.player_id === currentPlayer.id;
                const isVoted = votedEntries.has(entry.id);
                
                return (
                  <span
                    key={entry.id}
                    className={`word${isOwnEntry ? ' own-word' : ' clickable'}${isVoted ? ' voted' : ''}`}
                    style={{ backgroundColor: entry.playerColor }}
                    onClick={() => !isOwnEntry && handleWordClick(entry)}
                    title={`${entry.playerName}'s ${category}`}
                  >
                    {entry.text}
                    {isVoted && <span className="vote-check">✓</span>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        <div className="voting-actions">
          <button
            onClick={handleDoneVoting}
            className="start-button"
          >
            Done Voting
          </button>
        </div>
      </div>
      
      <Footer />
    </div>
  );
};
