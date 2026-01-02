// Database types matching Supabase schema

export interface Database {
  public: {
    Tables: {
      games: {
        Row: {
          id: string
          name: string
          host_id: string
          status: 'waiting' | 'in_progress' | 'completed'
          player_count: number
          max_players: number
          current_round: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          host_id: string
          status?: 'waiting' | 'in_progress' | 'completed'
          player_count?: number
          max_players?: number
          current_round?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          host_id?: string
          status?: 'waiting' | 'in_progress' | 'completed'
          player_count?: number
          max_players?: number
          current_round?: number
          created_at?: string
          updated_at?: string
        }
      }
      players: {
        Row: {
          id: string
          game_id: string
          user_id: string | null
          name: string
          color: string
          score: number
          lifetime_score: number
          is_host: boolean
          ready: boolean
          join_order: number
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          user_id?: string | null
          name: string
          color: string
          score?: number
          lifetime_score?: number
          is_host?: boolean
          ready?: boolean
          join_order: number
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          user_id?: string | null
          name?: string
          color?: string
          score?: number
          lifetime_score?: number
          is_host?: boolean
          ready?: boolean
          join_order?: number
          created_at?: string
        }
      }
      entries: {
        Row: {
          id: string
          game_id: string
          player_id: string
          round: number
          category: 'title' | 'name' | 'verb' | 'adverb' | 'preposition' | 'noun'
          text: string
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          player_id: string
          round: number
          category: 'title' | 'name' | 'verb' | 'adverb' | 'preposition' | 'noun'
          text: string
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          player_id?: string
          round?: number
          category?: 'title' | 'name' | 'verb' | 'adverb' | 'preposition' | 'noun'
          text?: string
          created_at?: string
        }
      }
      votes: {
        Row: {
          id: string
          game_id: string
          player_id: string
          entry_id: string
          round: number
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          player_id: string
          entry_id: string
          round: number
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          player_id?: string
          entry_id?: string
          round?: number
          created_at?: string
        }
      }
      user_stats: {
        Row: {
          user_id: string
          lifetime_score: number
          games_played: number
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          lifetime_score?: number
          games_played?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          lifetime_score?: number
          games_played?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}

// Export types with explicit declarations
export type Game = Database['public']['Tables']['games']['Row'];
export type Player = Database['public']['Tables']['players']['Row'];
export type Entry = Database['public']['Tables']['entries']['Row'];
export type Vote = Database['public']['Tables']['votes']['Row'];
export type UserStats = Database['public']['Tables']['user_stats']['Row'];

export type GameInsert = Database['public']['Tables']['games']['Insert'];
export type PlayerInsert = Database['public']['Tables']['players']['Insert'];
export type EntryInsert = Database['public']['Tables']['entries']['Insert'];
export type VoteInsert = Database['public']['Tables']['votes']['Insert'];

