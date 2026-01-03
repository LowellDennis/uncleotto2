import { supabase } from './supabase'
import type { Game, Player, GameInsert, PlayerInsert } from '../types/database.types'

// Player colors for assignment
const PLAYER_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Orange
  '#98D8C8', // Mint
  '#F7DC6F', // Yellow
]

export const gameService = {
  /**
   * Get or create user stats
   */
  async getUserStats(userId: string): Promise<{ lifetime_score: number; games_played: number }> {
    try {
      // Try to get existing stats
      const { data: stats, error: fetchError } = await supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw fetchError;
      }

      if (stats) {
        return { lifetime_score: stats.lifetime_score, games_played: stats.games_played };
      }

      // Create new stats if none exist
      const { data: newStats, error: insertError } = await supabase
        .from('user_stats')
        .insert({ user_id: userId, lifetime_score: 0, games_played: 0 })
        .select()
        .single();

      if (insertError) throw insertError;

      return { lifetime_score: newStats.lifetime_score, games_played: newStats.games_played };
    } catch (error) {
      return { lifetime_score: 0, games_played: 0 };
    }
  },

  /**
   * Create a new game
   */
  async createGame(gameName: string, playerName: string, userId: string): Promise<{ game: Game | null; player: Player | null; error: any }> {
    try {
      // Get user's lifetime score
      const { lifetime_score } = await this.getUserStats(userId);

      // Create the game
      const gameData: GameInsert = {
        name: gameName,
        host_id: userId,
        status: 'waiting',
        player_count: 1,
      }

      const { data: game, error: gameError } = await supabase
        .from('games')
        .insert(gameData)
        .select()
        .single()

      if (gameError) {
        throw gameError
      }

      // Add the host as the first player
      const playerData: PlayerInsert = {
        game_id: game.id,
        user_id: userId,
        name: playerName,
        color: PLAYER_COLORS[0],
        is_host: true,
        join_order: 1,
        lifetime_score,
      }

      const { data: player, error: playerError } = await supabase
        .from('players')
        .insert(playerData)
        .select()
        .single()

      if (playerError) {
        // Clean up the game if player creation fails
        await supabase.from('games').delete().eq('id', game.id)
        throw playerError
      }

      return { game, player, error: null }
    } catch (error) {
      return { game: null, player: null, error }
    }
  },

  /**
   * Join an existing game
   */
  async joinGame(gameId: string, playerName: string, userId: string): Promise<{ player: Player | null; error: any }> {
    try {
      // Get user's lifetime score
      const { lifetime_score } = await this.getUserStats(userId);

      // Get current game state
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('*, players(*)')
        .eq('id', gameId)
        .single()

      if (gameError) throw gameError

      // Check if game is full
      if (game.player_count >= game.max_players) {
        throw new Error('Game is full')
      }

      // Check if game has started
      if (game.status !== 'waiting') {
        throw new Error('Game has already started')
      }

      // Check if user is already in the game
      const existingPlayer = game.players?.find((p: any) => p.user_id === userId)
      if (existingPlayer) {
        return { player: existingPlayer, error: null }
      }

      // Assign next available color
      const usedColors = game.players?.map((p: any) => p.color) || []
      const availableColor = PLAYER_COLORS.find(color => !usedColors.includes(color)) || PLAYER_COLORS[0]

      // Add player to game
      const playerData: PlayerInsert = {
        game_id: gameId,
        user_id: userId,
        name: playerName,
        color: availableColor,
        is_host: false,
        lifetime_score,
        join_order: game.player_count + 1,
      }

      const { data: player, error: playerError } = await supabase
        .from('players')
        .insert(playerData)
        .select()
        .single()

      if (playerError) throw playerError

      // Update game player count
      const { error: updateError } = await supabase
        .from('games')
        .update({ player_count: game.player_count + 1 })
        .eq('id', gameId)

      if (updateError) throw updateError

      return { player, error: null }
    } catch (error) {
      return { player: null, error }
    }
  },

  /**
   * Get all available games
   */
  async getAvailableGames(): Promise<{ games: Game[]; error: any }> {
    try {
      const { data: games, error } = await supabase
        .from('games')
        .select('*')
        .eq('status', 'waiting')
        .order('created_at', { ascending: false })

      if (error) throw error

      return { games: games || [], error: null }
    } catch (error) {
      return { games: [], error }
    }
  },

  /**
   * Subscribe to game changes with incremental updates
   */
  subscribeToGames(onInsert: (game: Game) => void, onUpdate: (game: Game) => void, onDelete: (gameId: string) => void) {
    const channel = supabase
      .channel('games-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'games' },
        (payload) => onInsert(payload.new as Game)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        (payload) => onUpdate(payload.new as Game)
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'games' },
        (payload) => {
          const deletedGame = payload.old as any;
          if (deletedGame?.id) onDelete(deletedGame.id);
        }
      )
      .subscribe();

    return channel;
  },

  /**
   * Leave a game
   */
  async leaveGame(gameId: string, playerId: string): Promise<{ error: any }> {
    try {
      // Get player info to check if they're the host
      const { data: player, error: playerFetchError } = await supabase
        .from('players')
        .select('is_host')
        .eq('id', playerId)
        .single()

      if (playerFetchError) throw playerFetchError

      // Delete player
      const { error: deleteError } = await supabase
        .from('players')
        .delete()
        .eq('id', playerId)

      if (deleteError) throw deleteError

      // Update game player count
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('player_count')
        .eq('id', gameId)
        .single()

      if (gameError) throw gameError

      const newPlayerCount = game.player_count - 1

      if (newPlayerCount === 0 || player.is_host) {
        // Delete game if no players left or host left
        await supabase.from('games').delete().eq('id', gameId)
      } else {
        // Update player count
        await supabase
          .from('games')
          .update({ player_count: newPlayerCount })
          .eq('id', gameId)
      }

      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  /**
   * Start a game (host only)
   */
  async startGame(gameId: string): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('games')
        .update({ status: 'in_progress', current_round: 1 })
        .eq('id', gameId)

      if (error) throw error

      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  /**
   * Delete a game (host only)
   */
  async deleteGame(gameId: string): Promise<{ error: any }> {
    try {
      // Get all players with their scores before deleting
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('user_id, score')
        .eq('game_id', gameId);

      if (playersError) throw playersError;

      // Update lifetime scores for all players
      if (players && players.length > 0) {
        for (const player of players) {
          if (player.user_id) {
            // Get current stats
            const { data: stats } = await supabase
              .from('user_stats')
              .select('lifetime_score, games_played')
              .eq('user_id', player.user_id)
              .single();

            const currentLifetime = stats?.lifetime_score || 0;
            const currentGames = stats?.games_played || 0;

            // Update or insert stats - increment games_played for all, add score if > 0
            await supabase
              .from('user_stats')
              .upsert({
                user_id: player.user_id,
                lifetime_score: currentLifetime + (player.score || 0),
                games_played: currentGames + 1,
                updated_at: new Date().toISOString()
              });
          }
        }
      }

      // Delete the game (players will cascade delete)
      const { error } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId)

      if (error) throw error

      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  /**
   * Remove a player from a game
   */
  async removePlayer(playerId: string): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('players')
        .delete()
        .eq('id', playerId)

      if (error) throw error

      return { error: null }
    } catch (error) {
      return { error }
    }
  },
}
