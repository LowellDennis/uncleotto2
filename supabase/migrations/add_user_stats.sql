-- Create user_stats table for lifetime scores
CREATE TABLE IF NOT EXISTS user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lifetime_score INTEGER DEFAULT 0 NOT NULL,
  games_played INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

-- Allow users to view all stats
CREATE POLICY "Allow all users to view user stats"
  ON user_stats FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to insert/update their own stats
CREATE POLICY "Allow users to manage their own stats"
  ON user_stats FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add lifetime_score to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS lifetime_score INTEGER DEFAULT 0 NOT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_stats_user_id ON user_stats(user_id);
