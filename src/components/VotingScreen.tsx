import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  const [isDoneVoting, setIsDoneVoting] = useState(false);
  const [voteCounts, setVoteCounts] = useState<Map<string, number>>(new Map());
  const [playersReady, setPlayersReady] = useState<Set<string>>(new Set());
  const [unanimousEntries, setUnanimousEntries] = useState<Set<string>>(new Set());
  const gameDeleted = useRef(false);
  const hasNavigated = useRef(false);
  const gameRef = useRef<Game | null>(null);
  const playersRef = useRef<Player[]>([]);

  // Keep refs in sync with state
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  // Reset navigation flag when entering screen
  useEffect(() => {
    hasNavigated.current = false;
  }, []);

  const loadVoteCounts = useCallback(async (gameData?: Game, playersCount?: number) => {
    const currentGame = gameData || gameRef.current;
    const currentPlayersCount = playersCount ?? playersRef.current.length;
    
    if (!gameId || !currentGame) return;
    
    try {
      // Load all votes for this game and round
      const { data: votesData, error } = await supabase
        .from('votes')
        .select('entry_id')
        .eq('game_id', gameId)
        .eq('round', currentGame.current_round);
      
      if (error) {
        return;
      }
      
      // Count votes per entry
      const counts = new Map<string, number>();
      votesData?.forEach(vote => {
        counts.set(vote.entry_id, (counts.get(vote.entry_id) || 0) + 1);
      });
      
      console.log('[VotingScreen] loadVoteCounts:', {
        round: currentGame.current_round,
        totalVotes: votesData?.length || 0,
        entryCounts: Array.from(counts.entries())
      });
      
      setVoteCounts(counts);
      
      // Detect unanimous entries (only for games with 4+ players)
      const unanimous = new Set<string>();
      if (currentPlayersCount >= 4) {
        const requiredVotes = currentPlayersCount - 1; // Everyone except the author
        
        counts.forEach((count, entryId) => {
          if (count >= requiredVotes) {
            unanimous.add(entryId);
          }
        });
      }
      
      setUnanimousEntries(unanimous);
    } catch (err) {
    }
  }, [gameId]);

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
            const updatedGame = payload.new as Game;
            
            // Check if round was incremented (all players ready, moving to next round)
            if (game && updatedGame.current_round > game.current_round && !hasNavigated.current) {
              hasNavigated.current = true;
              navigate(`/game/${gameId}/entry`);
              return;
            }
            
            setGame(updatedGame);
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
        async (payload) => {
          const updatedPlayer = payload.new as Player;
          setPlayers(prev => {
            const updated = prev.map(p => 
              p.id === updatedPlayer.id ? updatedPlayer : p
            );
            
            // Update playersReady set for checkmarks
            setPlayersReady(new Set(updated.filter(p => p.ready).map(p => p.id)));
            
            // Check if all players are ready
            const allReady = updated.every(p => p.ready);
            if (allReady) {
              // Find current user in updated array to get fresh host status
              const currentUserPlayer = updated.find(p => p.user_id === user?.id);
              
              // If this is the host, increment the round
              if (currentUserPlayer?.is_host && !hasNavigated.current) {
                // Get fresh game data
                supabase
                  .from('games')
                  .select('current_round')
                  .eq('id', gameId)
                  .single()
                  .then(({ data: freshGame }) => {
                    if (freshGame) {
                      supabase
                        .from('games')
                        .update({ current_round: freshGame.current_round + 1 })
                        .eq('id', gameId)
                        .then(() => {
                          // Reset all players' ready state
                          updated.forEach(p => {
                            supabase
                              .from('players')
                              .update({ ready: false })
                              .eq('id', p.id);
                          });
                        });
                    }
                  });
              }
            }
            
            return updated;
          });
          
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'votes',
          filter: `game_id=eq.${gameId}`
        },
        () => {
          // Reload vote counts when any vote changes
          loadVoteCounts();
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
      const player = (playersData || []).find(p => p.user_id === user?.id) || null;
      setCurrentPlayer(player);
      
      // Initialize playersReady set for checkmarks
      setPlayersReady(new Set((playersData || []).filter(p => p.ready).map(p => p.id)));

      // Load current player's votes
      if (player) {
        const { data: votesData } = await supabase
          .from('votes')
          .select('entry_id')
          .eq('game_id', gameId)
          .eq('player_id', player.id)
          .eq('round', gameData.current_round);
        
        if (votesData) {
          setVotedEntries(new Set(votesData.map(v => v.entry_id)));
        }
      }

      // Load entries and generate sentences
      await loadEntriesAndGenerateSentences(gameData, playersData || []);
    } catch (err) {
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
      
      // Load vote counts with explicit game data
      await loadVoteCounts(gameData, playersData.length);
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
    if (!currentPlayer || !game) return;
    
    // Can't vote for your own entries
    if (entry.player_id === currentPlayer.id) return;
    
    // Can't vote if done voting
    if (isDoneVoting) return;

    try {
      const isVoted = votedEntries.has(entry.id);
      
      if (isVoted) {
        // REMOVE VOTE: Decrement player score and delete vote record
        const player = players.find(p => p.id === entry.player_id);
        if (player) {
          const newScore = Math.max(0, player.score - 1);
          
          const { error } = await supabase
            .from('players')
            .update({ score: newScore })
            .eq('id', entry.player_id);
          
          if (error) {
            console.error('[VotingScreen] Error updating player score:', error);
            return;
          }
          
          // Delete vote record
          await supabase
            .from('votes')
            .delete()
            .eq('game_id', gameId!)
            .eq('player_id', currentPlayer.id)
            .eq('entry_id', entry.id)
            .eq('round', game.current_round);
          
          // Update local state immediately
          setPlayers(prev => prev.map(p => 
            p.id === entry.player_id ? { ...p, score: newScore } : p
          ));
          
          // Update vote counts locally
          setVoteCounts(prev => {
            const updated = new Map(prev);
            const currentCount = updated.get(entry.id) || 0;
            const newCount = Math.max(0, currentCount - 1);
            if (newCount === 0) {
              updated.delete(entry.id);
            } else {
              updated.set(entry.id, newCount);
            }
            return updated;
          });
        }
        
        // Remove from votedEntries
        const newVotedEntries = new Set(votedEntries);
        newVotedEntries.delete(entry.id);
        setVotedEntries(newVotedEntries);
        
      } else {
        // ADD VOTE: Increment player score and insert vote record
        const player = players.find(p => p.id === entry.player_id);
        if (player) {
          const newScore = player.score + 1;
          
          // Update database
          const { error } = await supabase
            .from('players')
            .update({ score: newScore })
            .eq('id', entry.player_id);
          
          if (error) {
            console.error('[VotingScreen] Error updating player score:', error);
            return;
          }
          
          // Insert vote record
          await supabase
            .from('votes')
            .insert({
              game_id: gameId!,
              player_id: currentPlayer.id,
              entry_id: entry.id,
              round: game.current_round
            });
          
          // Update local state immediately
          setPlayers(prev => prev.map(p => 
            p.id === entry.player_id ? { ...p, score: newScore } : p
          ));
          
          // Update vote counts locally
          setVoteCounts(prev => {
            const updated = new Map(prev);
            const currentCount = updated.get(entry.id) || 0;
            const newCount = currentCount + 1;
            updated.set(entry.id, newCount);
            return updated;
          });
        }
        
        // Add to votedEntries
        const newVotedEntries = new Set(votedEntries);
        newVotedEntries.add(entry.id);
        setVotedEntries(newVotedEntries);
      }
    } catch (err) {
      console.error('[VotingScreen] Error in handleWordClick:', err);
    }
  };

  const handleDoneVoting = async () => {
    if (!currentPlayer || !game) return;

    try {
      setError(null);

      // Mark player as ready
      const { error } = await supabase
        .from('players')
        .update({ ready: true })
        .eq('id', currentPlayer.id);

      if (error) throw error;

      // Update local state
      setIsDoneVoting(true);
      setCurrentPlayer(prev => prev ? { ...prev, ready: true } : null);
      
      // Check if all players are now ready
      setPlayers(prev => {
        const updated = prev.map(p => 
          p.id === currentPlayer.id ? { ...p, ready: true } : p
        );
        
        // Update playersReady set for checkmarks
        setPlayersReady(new Set(updated.filter(p => p.ready).map(p => p.id)));
        
        // Check if all players are ready
        const allReady = updated.every(p => p.ready);
        if (allReady) {
          // Find current user in updated array to get fresh host status
          const currentUserPlayer = updated.find(p => p.user_id === user?.id);
          
          // If this is the host, increment the round
          if (currentUserPlayer?.is_host && !hasNavigated.current) {
            // Get fresh game data
            supabase
              .from('games')
              .select('current_round')
              .eq('id', gameId!)
              .single()
              .then(({ data: freshGame }) => {
                if (freshGame) {
                  supabase
                    .from('games')
                    .update({ current_round: freshGame.current_round + 1 })
                    .eq('id', gameId!)
                    .then(() => {
                      // Reset all players' ready state
                      updated.forEach(p => {
                        supabase
                          .from('players')
                          .update({ ready: false })
                          .eq('id', p.id);
                      });
                    });
                }
              });
          }
        }
        
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finish voting');
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
    
    const message = players.length === 2
      ? 'If you leave the game there will not be enough to continue. Are you sure?'
      : 'Are you sure you want to leave this game?';

    if (confirm(message)) {
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

  const handleTakeOverHost = async () => {
    if (!currentPlayer || !game) return;

    try {
      // Get current host
      const currentHost = players.find(p => p.is_host);
      if (!currentHost) return;

      // Update old host to not be host
      await supabase
        .from('players')
        .update({ is_host: false })
        .eq('id', currentHost.id);

      // Make current player the new host
      await supabase
        .from('players')
        .update({ is_host: true })
        .eq('id', currentPlayer.id);

      // Update game host_id
      await supabase
        .from('games')
        .update({ host_id: currentPlayer.user_id })
        .eq('id', game.id);
    } catch (err) {
      setError('Failed to take over as host');
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
          playersReady={playersReady}
          showKickButton={currentPlayer?.is_host || false}
          onKickPlayer={handleKickPlayer}
          onTakeOverHost={!currentPlayer?.is_host && currentPlayer ? handleTakeOverHost : undefined}
        />

        <div className="sentences-container">
          <div className="voting-instructions">
            {isDoneVoting 
              ? 'Waiting for other players to finish voting...'
              : 'Click on entries you like (except you own) to vote for them!'
            }
          </div>
          
          {sentences.map((sentence) => (
            <div key={sentence.id} className="sentence">
              {['title', 'name', 'verb', 'adverb', 'preposition', 'noun'].map((category) => {
                const entry = sentence[category as keyof Sentence] as WordEntry;
                if (!entry) return null;
                
                const isOwnEntry = currentPlayer && entry.player_id === currentPlayer.id;
                const isVoted = votedEntries.has(entry.id);
                const voteCount = voteCounts.get(entry.id) || 0;
                const isUnanimous = unanimousEntries.has(entry.id);
                
                return (
                  <span
                    key={entry.id}
                    className={`word${isOwnEntry ? ' own-word' : isDoneVoting ? '' : ' clickable'}${isUnanimous ? ' unanimous' : ''}`}
                    style={{ backgroundColor: entry.playerColor }}
                    onClick={() => !isOwnEntry && !isDoneVoting && handleWordClick(entry)}
                    title={`${entry.playerName}'s ${category}`}
                  >
                    <span className="word-text">{entry.text}</span>
                    {voteCount > 0 && <span className="vote-count">({voteCount})</span>}
                    {isVoted && <span className="vote-check">✓</span>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        <div className="voting-actions">
          {isDoneVoting ? (
            <div className="waiting-message">
              Waiting for other players to finish voting...
            </div>
          ) : (
            <button
              onClick={handleDoneVoting}
              className="start-button"
            >
              Done Voting
            </button>
          )}
        </div>
      </div>
      
      <Footer />
    </div>
  );
};
