-- Uncle Otto Game Database Schema

-- Games table
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, in_progress, completed
  player_count INTEGER NOT NULL DEFAULT 1,
  max_players INTEGER NOT NULL DEFAULT 6,
  current_round INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  is_host BOOLEAN NOT NULL DEFAULT false,
  ready BOOLEAN NOT NULL DEFAULT false,
  join_order INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Entries table (for game submissions)
CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  category TEXT NOT NULL, -- title, name, verb, adverb, preposition, noun
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Votes table
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(player_id, round, entry_id)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at);
CREATE INDEX IF NOT EXISTS idx_players_game_id ON players(game_id);
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_game_id ON entries(game_id);
CREATE INDEX IF NOT EXISTS idx_entries_round ON entries(round);
CREATE INDEX IF NOT EXISTS idx_votes_game_id ON votes(game_id);
CREATE INDEX IF NOT EXISTS idx_votes_round ON votes(round);

-- Enable Row Level Security (RLS)
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for games table
-- Anyone can view games that are waiting
CREATE POLICY "Games are viewable by everyone" ON games
  FOR SELECT USING (status = 'waiting' OR status = 'in_progress');

-- Authenticated users can create games
CREATE POLICY "Authenticated users can create games" ON games
  FOR INSERT WITH CHECK (auth.uid() = host_id);

-- Only the host can update their game
CREATE POLICY "Hosts can update their games" ON games
  FOR UPDATE USING (auth.uid() = host_id);

-- Only the host can delete their game
CREATE POLICY "Hosts can delete their games" ON games
  FOR DELETE USING (auth.uid() = host_id);

-- RLS Policies for players table
-- Players can view all players in games that are viewable
CREATE POLICY "Players can view players in public games" ON players
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM games g WHERE g.id = players.game_id AND (g.status = 'waiting' OR g.status = 'in_progress')
    )
  );

-- Authenticated users can join games
CREATE POLICY "Authenticated users can join games" ON players
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Players can update their own data
CREATE POLICY "Players can update their own data" ON players
  FOR UPDATE USING (auth.uid() = user_id);

-- Players can leave games (delete their player record)
CREATE POLICY "Players can leave games" ON players
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for entries table
-- Players in a game can view entries in that game
CREATE POLICY "Players can view entries in their games" ON entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM players p WHERE p.game_id = entries.game_id AND p.user_id = auth.uid()
    )
  );

-- Players can create entries
CREATE POLICY "Players can create entries" ON entries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM players p WHERE p.id = entries.player_id AND p.user_id = auth.uid()
    )
  );

-- RLS Policies for votes table
-- Players in a game can view votes
CREATE POLICY "Players can view votes in their games" ON votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM players p WHERE p.game_id = votes.game_id AND p.user_id = auth.uid()
    )
  );

-- Players can vote
CREATE POLICY "Players can vote" ON votes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM players p WHERE p.id = votes.player_id AND p.user_id = auth.uid()
    )
  );

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up orphaned games (games with no players or no host)
CREATE OR REPLACE FUNCTION cleanup_orphaned_games()
RETURNS TABLE(deleted_count INTEGER) AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete games with no players OR no host player
  DELETE FROM games
  WHERE id NOT IN (SELECT DISTINCT game_id FROM players)
     OR id NOT IN (SELECT DISTINCT game_id FROM players WHERE is_host = true);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN QUERY SELECT deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on games table
CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE games;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE entries;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
