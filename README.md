# Uncle Otto

## Introduction
- This prompt file is for the generation and upkeep of an online game named "Uncle Otto"
- The game is played by 2 to 6 players and involves replacing parts of the sentence "Uncle Otto splashes happily in the bathtub." with appropriate substitutions.
- The parts being replaced are "Uncle" (a title), "Otto" (a name), "splashes" (an active verb), "happily" (an adverb), "in the" (the beginning of a proposition), and "bathtub" (a noun).

## Technical Architecture

### Supabase Backend
- Database: PostgreSQL with tables for games, players, entries, votes
- Authentication: Email/password, GitHub OAuth, anonymous (guest play)
- Real-time: Enabled on all tables for live multiplayer updates
- Security: Row Level Security (RLS) policies enforce game permissions
- Free tier considerations: Optimize for minimal database queries and bandwidth

### Real-time Optimization Patterns
**CRITICAL: Follow these patterns for all new features to minimize Supabase usage on free tier**

1. **Single Channel Per Screen**
   - Use ONE Supabase channel per component, not multiple
   - Combine multiple table listeners on the same channel
   - Example: LobbyScreen uses one channel for both games and players tables

2. **Incremental State Updates**
   - Handle INSERT/UPDATE/DELETE events individually
   - Update React state incrementally, never reload full datasets
   - Only query database on initial component load
   - Example pattern:
     ```typescript
     channel
       .on('INSERT', (payload) => setState(prev => [...prev, payload.new]))
       .on('UPDATE', (payload) => setState(prev => prev.map(item => item.id === payload.new.id ? payload.new : item)))
       .on('DELETE', (payload) => setState(prev => prev.filter(item => item.id !== payload.old.id)))
     ```

3. **Parallel Initial Loads**
   - When loading multiple datasets on mount, use Promise.all()
   - Reduces sequential database round trips
   - Example: `Promise.all([loadGames(), loadPlayers()])`

4. **Service Layer Pattern**
   - All database operations in `/src/lib/gameService.ts`
   - Real-time subscriptions return incremental callbacks, not full reload triggers
   - Exported functions: createGame, joinGame, leaveGame, startGame, subscribeToGames

5. **Cleanup Subscriptions**
   - Always unsubscribe from channels in useEffect cleanup
   - Prevents memory leaks and duplicate subscriptions

### Real-time Score Updates Implementation
**CRITICAL: VotingScreen uses Realtime subscriptions ONLY - no polling**

1. **Score Update Flow**
   - Player clicks on a word → immediate local state update
   - Database UPDATE executed via supabase.from('players').update({ score: newScore })
   - Supabase broadcasts UPDATE event to all subscribed clients
   - Each client's Realtime handler updates their local state
   - All browsers show updated score within milliseconds

2. **Vote/Unvote Handlers**
   ```typescript
   // Add vote
   const newScore = player.score + 1;
   await supabase.from('players').update({ score: newScore }).eq('id', entry.player_id);
   setPlayers(prev => prev.map(p => p.id === entry.player_id ? {...p, score: newScore} : p));

   // Remove vote
   const newScore = Math.max(0, player.score - 1);
   await supabase.from('players').update({ score: newScore }).eq('id', entry.player_id);
   setPlayers(prev => prev.map(p => p.id === entry.player_id ? {...p, score: newScore} : p));
   ```

3. **Realtime Subscription Handler**
   ```typescript
   .on('postgres_changes', {
     event: 'UPDATE',
     table: 'players',
     filter: `game_id=eq.${gameId}`
   }, (payload) => {
     const updatedPlayer = payload.new as Player;
     setPlayers(prev => prev.map(p => p.id === updatedPlayer.id ? updatedPlayer : p));
     if (updatedPlayer.user_id === user?.id) {
       setCurrentPlayer(updatedPlayer);
     }
   })
   ```

4. **Critical Requirements**
   - RLS UPDATE policy must exist: "Allow authenticated users to update player scores"
   - REPLICA IDENTITY FULL on players table ensures all columns broadcast
   - No score protection logic (database is source of truth)
   - Immediate local state update + database write for optimal UX
   - DELETE event handler to check for minimum player count (< 2 terminates game)

### Database Schema
- See `/database/schema.sql` for complete schema
- Tables: games, players, entries, votes, user_stats
- **user_stats table:** Tracks lifetime_score and games_played per user
- **players table:** Contains both score (game score) and lifetime_score (snapshot at join)
- **votes table:** Tracks individual votes (game_id, player_id, entry_id, round)
- Indexes on frequently queried fields (game_id, round, status)
- Triggers for automatic timestamp updates
- **RLS Policies:**
  - players: SELECT and UPDATE policies allow all authenticated users
  - user_stats: SELECT for all authenticated, ALL for own stats only
  - votes: INSERT and DELETE for authenticated users
  - REPLICA IDENTITY FULL on players table for complete real-time updates

### Dual-Score System Architecture
**CRITICAL: The game tracks two separate score types per player**

1. **Lifetime Scores (user_stats table)**
   - Cumulative score across all games a user has ever played
   - Persists in the user_stats table linked to user_id
   - Incremented when a game ends (host clicks "End Game")
   - Displayed ONLY in the Lobby Screen before game starts
   - Includes games_played counter for statistics

2. **Game Scores (players.score column)**
   - Score for the current game, accumulated across all voting rounds
   - **Not reset between rounds** - votes accumulate throughout the entire game
   - Updated in real-time as players vote/unvote
   - Displayed during all gameplay screens (Entry, Waiting, Voting)
   - Saved to lifetime totals when game ends

3. **Implementation Flow**
   - When player creates/joins game: gameService.getUserStats() loads their lifetime score
   - During voting: players.score increments/decrements with each vote/unvote
   - Between rounds: Scores persist (no reset)
   - When game ends: gameService.deleteGame() adds each player's game score to their lifetime total
   - Next game: Player's lifetime score reflects cumulative progress

4. **UI Display Rules**
   - LobbyScreen: Shows lifetime scores with message "Scores shown are lifetime scores"
   - EntryScreen: Shows game scores (accumulated across all rounds)
   - VotingScreen: Shows game scores (real-time updates) with vote counts on entries
   - **Vote counts update immediately via local state + real-time subscription (piggyback pattern)**
   - Entry vote counts "(1)", "(2)" displayed next to each word, visible to ALL players
   - Vote counts use white-space: nowrap to prevent splitting across lines
   - Both systems use immediate local update + database sync for instant feedback
   - **Unanimous entries:** When an entry receives votes from all players except the entry's author, it's outlined in gold
   - Gold styling: 3px solid gold border with glowing box-shadow effect (rgba(255, 215, 0, 0.6))
   - Unanimous status updates in real-time as votes change
   - No individual checkmarks on entries (only total vote count shown)

5. **Database Migrations**
   - Migration file: `/supabase/migrations/add_user_stats.sql`
   - Creates user_stats table with RLS policies
   - Adds lifetime_score column to players table
   - Must be run in Supabase SQL Editor before lifetime scores will persist

### Complete Game Flow
**CRITICAL: Understand the full game lifecycle and automatic progressions**

1. **Game Creation/Joining Phase**
   - Players land on Gathering Screen
   - Host creates game → navigates to Lobby Screen
   - Other players join game → navigate to Lobby Screen
   - Lobby shows lifetime scores (cumulative across all games)
   - Host clicks "Start Game" (or auto-starts at 6 players) → all navigate to Entry Screen

2. **Round Loop (Infinite until game ends)**
   
   **A. Entry Phase**
   - All players enter their 6 word substitutions
   - **Game scores displayed (accumulate across all rounds - not reset)**
   - Players click "Submit Entries" → button disappears, fields disabled
   - Message appears: "Waiting for other players to submit their entries..."
   - Entries remain visible
   - Checkmarks appear next to players who have submitted
   - **When all players submit → all auto-navigate to Voting Screen**
   
   **B. Voting Phase**
   - **Score Accumulation:** Scores persist and accumulate across all rounds (never reset until game ends)
   - Generated sentences displayed with colored word contributions
   - Players click words to vote for them (checkmark ✓ appears)
   - Players click again to unvote (checkmark disappears)
   - Vote counts displayed next to entries in real-time (e.g., "(1)", "(2)")
   - **Both entry vote counts AND player badge scores update immediately via local state + real-time sync**
   - Scores update in real-time across all browsers (Supabase Realtime)
   - Players click "Done Voting" → button hidden, checkmark appears on player badge
   - Message appears: "Waiting for other players to finish voting..."
   - Sentences remain visible and clickable with vote counts continuing to update
   - **When all players ready → host increments game.current_round**
   - **All players auto-navigate back to Entry Screen**
   - **Loop repeats indefinitely** (Entry → Voting → Entry → Voting...)

3. **Game Termination**
   - **Host Action:** Host clicks "End Game" button (available on all screens)
     - Confirmation dialog: "Are you sure you want to end this game?"
     - If confirmed:
       - All players' game scores saved to their lifetime totals in user_stats
       - All players navigated to Gathering Screen
       - Game deleted from database
   
   - **Insufficient Players:** Player count drops below 2
     - Alert shown to all players: "Not enough players to continue. Game ending."
     - Same save/delete/navigate flow as host termination

4. **Score Persistence on Game End**
   ```typescript
   // gameService.deleteGame() implementation
   for (const player of players) {
     if (player.user_id && player.score > 0) {
       // Fetch current lifetime stats
       const stats = await getUserStats(player.user_id);
       
       // Save updated totals
       await supabase.from('user_stats').upsert({
         user_id: player.user_id,
         lifetime_score: stats.lifetime_score + player.score,
         games_played: stats.games_played + 1
       });
     }
   }
   ```

5. **Critical Flow Rules**
   - Lobby Screen shown ONLY at game creation/join (not between rounds)
   - **No separate waiting screens - waiting happens in-screen with messages**
   - **Scores accumulate across all rounds (never reset until game ends)**
   - Game scores saved to lifetime totals only when game ends (not after each round)
   - Automatic navigation requires coordination: host performs DB updates, all clients listen for changes
   - **Vote counts and checkmarks displayed in real-time as players vote**
   - **Entries remain clickable after "Done Voting" so players can see real-time vote updates**
   - Players remain on Entry/Voting screens after completion (no screen transitions until all ready)

### Host Kick Functionality
**CRITICAL: Hosts can kick players from any screen to manage disruptive behavior**

1. **Kick Button Availability**
   - Enabled on ALL screens: LobbyScreen, EntryScreen, VotingScreen
   - Only visible when `currentPlayer.is_host === true`
   - Players cannot kick themselves or other hosts
   - Click on any other player's badge to kick them

2. **Kick Confirmation Messages**
   - **Normal kick (3+ players):** "Are you sure you want to kick [name] from the game?"
   - **2-Player kick:** "If you kick [name] from the game there will not be enough to continue. Are you sure?"
   - Warns host about game termination when only 2 players remain

3. **Kick Behavior Logic**
   ```typescript
   const handleKickPlayer = async (playerId: string) => {
     if (!gameId || !currentPlayer?.is_host) return;
     
     // If only 2 players, kicking one ends the game
     if (players.length === 2) {
       await gameService.deleteGame(gameId); // Saves lifetime scores, deletes game
     } else {
       await gameService.leaveGame(gameId, playerId); // Just removes player
     }
   };
   ```

4. **2-Player Kick Flow**
   - Host clicks other player's badge
   - Confirmation: "This will end the game"
   - On confirm: `gameService.deleteGame()` is called
   - Both players' lifetime scores updated
   - Game deleted from database (no orphan records)
   - Both players navigate to Gathering Screen
   - Same flow as host clicking "End Game" button

5. **3+ Player Kick Flow**
   - Host clicks player badge
   - Standard confirmation message
   - On confirm: Player deleted from database
   - Kicked player receives DELETE event → navigates to Gathering Screen
   - Remaining players see player removed from PlayerKey
   - Game continues normally

6. **Edge Cases Handled**
   - Prevents orphan game records in database
   - Ensures lifetime score persistence in all scenarios
   - PlayerKey component detects player count for appropriate messaging
   - All screens use consistent `handleKickPlayer` implementation

### Mobile-First UI/UX Optimizations
**CRITICAL: All UI elements optimized for mobile phone display (max-width: 800px)**

1. **Responsive Layout Standards**
   - App root: max-width 800px, centered with margin auto
   - All content containers: padding optimized for mobile (typically 8px horizontal)
   - Footer and Header: remain on single line across all screen sizes
   - No column-to-row media query transformations that break mobile layout

2. **Component-Specific Optimizations**
   
   **Game Header:**
   - Image and title text remain side-by-side on mobile (no stacking)
   - Font size scales down for mobile but maintains readability
   - No flex-direction column breakpoints
   
   **Footer:**
   - Single line display: "Copyright © Cyberclops LLC" | "V 26.0101.0000"
   - Font size: 10.5px for compact mobile display
   - Removed mobile media query that stacked content vertically
   
   **Player Badges:**
   - Compact layout: reduced gap from 8px to 4px
   - Reduced padding from 12px to 8px horizontal
   - Font size: 0.85rem for name and score
   - Score section: min-width reduced from 30px to 25px
   - Maximizes visible character count for player names
   - Grid layout: 3 badges per row maintained on mobile
   
   **Entry Screen:**
   - Round indicator above form: "Round #" in blue (#667eea)
   - Minimal vertical spacing (padding: 2px, margin: 2px)
   - Label width: reduced from 70px to 60px for more input space
   - Left padding: 8px (right padding: 20px preserved for scrollbar)
   - Gap between label and input: 4px (reduced from 6px)
   - Textareas: auto-growing from 36px to max 120px height
   - Auto-resize via useEffect based on scrollHeight
   - Vertical scroll with overflow-y when exceeding max height
   - Character counter below each textarea (not overlaying)
   - Single entry field per row, label above input
   
   **Wait Screen (WaitForEntriesScreen):**
   - Message font: 1rem (reduced from 1.2rem)
   - Padding: 12px vertical, 8px horizontal (reduced from 20px)
   - Message fits on single line on mobile devices
   
   **Voting Screen:**
   - Instructions message: "Click on entries you like (except you own) to vote for them!"
   - Message color: blue (#667eea) for consistency
   - Font size: 0.85rem (reduced from 1.1rem) to fit on single line
   - Horizontal padding: 8px (reduced from 20px)
   - Sentences: centered with text-align: center
   - Real-time score updates use Supabase Realtime (no polling)

3. **Auto-Transition Implementation**
   - Players remain on Entry/Voting screens after submission
   - Ready state tracked in players.ready field
   - Auto-navigate when all players ready using real-time subscriptions
   - Uses INSERT event on entries table for real-time coordination
   - Properly handles players array in state updates for DELETE events

4. **Typography Standards**
   - Primary font: 'Chewy' (non-cursive, playful) for labels and headings
   - Input font: 'Inter' (sans-serif) for all user inputs, placeholders, and character counters
   - Web font loading: Google Fonts for consistent cross-platform rendering
   - Font loaded in index.html: `Chewy&family=Inter:wght@400;600`
   - Blue accent color: #667eea (used for messages, round indicators, instructions)
   - Consistent font scaling across components for mobile readability

5. **Entry Field Layout (Mobile Optimized)**
   - Vertical layout: label and input stacked, counter below
   - Auto-growing textareas: min-height 36px, max-height 120px
   - Dynamic height adjustment via useEffect based on content scrollHeight
   - Character counter positioned below textarea (not overlaying)
   - Overflow-y for vertical scrolling when content exceeds max height
   - Eliminates horizontal scrolling for better mobile typing experience

6. **Spacing Standards**
   - Vertical gaps between components: 12px typical, 8px tight, 2px minimal
   - Horizontal padding: 8px left (maximizes input width), 20px right (preserves scrollbar space)
   - Component margins: typically 12px vertical, 0 horizontal
   - Grid gaps: 10px for player badge grids, 4px for inline elements

## Game Requirements
- The game must be coded in modern languages and be responsive so that it easily handles PCs, tablets, phones, and most browsers.
- Game must handle the nuances of non-mobile and mobile environments seemlessly.
- This include context switches (either deliberate or involuntary) which may cause temporary disconnects.
- Connectivity with the game needs to be bulletproof so that players can resume the game after these deliberate or involuntary interruptions.
- Game must allow players to switch apps, refresh the browser, and other such interruptions and still resume where they left off without losing context.
- Game must be resilient to errors.
- If needed, keeping the phone/tablet/PC from going to sleep or similar while playing the game is allowed.
- Players who are inadvertently disconnected (phone sleep, app switch, etc.) should be able to reconnect and resume the game.
- Players who voluntarily leave game do not need to be allowed to rejoin.
- Game will be deployed to an online cloud provider (at first this will be Render).
- Game will start with a "Gathering Screen" where players can create a game or join an already created game.
- Game must support ability for player names and favorite game names to be remembered and supplied by default.

## Game Components
- There are several recurring components that appear throughout the game.

### Game Header
- Has the Uncle Otto image and "Uncle Otto\nsplashes happily\nin the bathtub" side by side and centered at the top of the screen.
- The text in the header must be in a non-cursive font, preferably the "Chewy" font.
- The text is to be sized so that it fits nicely next to the Uncle Otto image.
- Since it is on three lines the text may be slightly larger height-wise than the image.

### Player Key
- Series of boxes with each players name, assigned color, and score.
- **Score Display:**
  - In the Lobby Screen: Shows **lifetime score** (cumulative across all games played)
  - During gameplay (Entry, Voting): Shows **game score** (accumulated across all rounds, never reset)
  - Game scores are saved to lifetime totals when the host ends the game
- Also contains a checkmark to indicate that they have finished the current activity (submitted entries or done voting).
- Current activities include entering substitutions and voting.
- The host appears first in the player key and has a gold star (★) to indicate that they are host.
- So as to not take up too much vertical space, there should be at least 2 and hopefully more player boxes per line.
- Player colors are assigned when they join the game and these colors should be predefined colors.
  - Must be easily distinguishable from one another (no close colors).
  - Must be light colors so that the information inside them is clearly readable.
- If the host clicks on a player's info in the player key (other than the host):
  - A pop-up asking "Are you sure you want to kick <player> from the game?" appears.
  - If the host confirms kicking player from the game
    - A message is displayed to all players stating "<Host-name> has kicked <player> from the game!".
	- The kicked player is taken to the "Gathering Screen" and is not allowed to re-enter the game.
- **Take Over Host Functionality:**
  - Available on all screens: LobbyScreen, EntryScreen, VotingScreen
  - If a non-host player clicks on the host's badge:
    - Confirmation dialog: "The host ([host name]) appears to be inactive. Do you want to take over as host?"
    - If confirmed:
      - Player becomes new host (games.host_id updated, is_host flag set)
      - Previous host becomes regular player if still connected
      - New host gains access to "End Game" button and kick functionality
      - No visible "Take Over As Host" button (triggered only by clicking host badge)
  - Database schema includes RLS policy allowing players in a game to transfer host status

### Game Buttons
- Normal buttons appear blue when active (clickable), and light blue when not active (not clickable).
- Danger buttons appear red when active (clickable), light red when not active (not clickable),
  - Danger buttons always cause a pop-up to confirm their associated actions.

#### Host "End Game" Button
- This button is a left justified Danger button that is always available to the host.
- It has pop-up text "Are you sure you want to end the game?"
- If the host confirms the game ends.
  - All players are taken back to the "Gathering Screen"
  - A a message stating "<host-name> has ended game <game-name>!" is displayed.
  - The game is removed from the "Available Game" area.

#### Host "Continue Game" Button"
- This allows the host to continue the game when something odd has happened and the automatic continue has not occurred.
- Clicking the "Continue Game" button causes the message "Are you sure you want to continue?" to be displayed to the host.
  - If the host confirms, all players are moved to next screen.
  - This can be either the "Entry Screen" or the "Voting Screen"

#### Other Players "Leave Game" Button
- This button is a left justified Danger button that is always avalable to non-hosts.
- It has pop-up text:
  - **2 players:** "If you leave the game there will not be enough to continue. Are you sure?"
  - **3+ players:** "Are you sure you want to leave this game?"
- If a player confirms
  - They are taken to the "Gathering Screen".
  - All other players stay but receive a message stating "<player> has left the game!".
  - If there were only two players then both players are taken to the "Gathering Screen".

## Game screens
- The game is series of screens with different components.

### The "Gathering Screen"
- When a player opens the web browser to the base address of the game, this is where they land.
- On this page is displayed the "Game Header" (see above) at the top.
- Under this are three authentication buttons displayed horizontally:
  - "Sign In" button (Normal) - Opens a modal popup with:
    - Email field
    - Password field
    - Auto-fills email from localStorage if previously saved
    - Validates credentials against Supabase authentication
    - On successful sign in, closes modal and shows player interface
  - "Create Account" button (Normal) - Opens a modal popup with:
    - Email field
    - Password field
    - Confirm Password field
    - Display Name field (becomes player name)
    - Personal Game Name field (becomes default game name)
    - Creates account in Supabase with user metadata
    - Saves display name and game name to user profile
    - On successful creation, closes modal and shows player interface
  - "Play As Guest" button (Primary/Green) - Most common option
    - Signs in anonymously through Supabase
    - Shows player interface immediately
- Once authenticated (any method), the following is displayed:
  - "Logged in as [email]" or "Logged in as Guest" shown at top right with red "Log Out" button
    - Separated by horizontal divider line below
    - Clicking "Log Out" returns to the three authentication buttons
  - "Name" prompt and text box (inline layout, prompt right-aligned, minimal width)
    - Auto-filled from user metadata (if logged in) or localStorage (if guest)
    - Auto-saves to localStorage on every keystroke
  - "Game" prompt and text box (inline layout, prompt right-aligned, minimal width)
    - Auto-filled from user metadata (if logged in) or localStorage (if guest)
    - Auto-saves to localStorage on every keystroke
  - "Create Game" button (Normal) directly under Game text box
    - Active when both Name and Game fields have text
    - Creates new game with player as host
    - Game name cannot clash with existing games in "Available Games" area
    - On success, player moves to "Lobby Screen"
  - Sections separated by horizontal divider lines (extending to screen edges)
  - "Available Games" heading (18px, left-aligned)
    - Lists available games, one per line, separated by horizontal divider lines (aligned with content)
    - Each game row shows:
      - Player count "#/6" on left (fixed width for grid alignment)
      - Game name to the right of player count
      - "Join Game" button (Normal) right justified
        - Active when Name field has text
        - Clicking increases # in #/6 by 1
        - Disables if # reaches 6
        - Takes player to "Lobby Screen"
        - Sets player score to 0
        - Assigns player a color
  - Footer at bottom (minimal padding)
    - "Copyright © Cyberclops LLC" on left
    - "V YYYY.MMDD.HHmm" on right (e.g., "V 2026.0103.0300")
    - Version constant stored in Footer.tsx component
    - **CRITICAL:** Version number MUST be updated with EVERY git push
      - Format: YYYY.MMDD.HHmm (4-digit year, 2-digit month, 2-digit day, 2-digit hour, 2-digit minute)
      - Used to verify cache clearing and confirm deployment on mobile devices
      - Update Footer.tsx APP_VERSION constant before each git push
    - **CRITICAL:** README.md MUST be updated with EVERY significant change
      - Update relevant sections when changing user-facing messages, game flow, or UI behavior
      - Keep confirmation messages, button behaviors, and game rules current
      - Document new features, screens, or components as they're added

**UI Design Principles:**
- Use horizontal divider lines instead of boxes to save screen real estate
- Minimal vertical spacing between sections
- Prompts right-aligned with minimal width to maximize text box width
- Mobile-responsive layout throughout

**Implementation Status:**
- ✅ Authentication (Sign In, Create Account, Play As Guest) fully functional with Supabase
- ✅ User metadata storage (display name, game name)
- ✅ Auto-fill from localStorage and user metadata
- ✅ UI layout complete with modal popups
- ✅ Footer component with version and copyright
- ✅ Clean divider-based layout optimized for mobile
- ✅ Database schema with RLS policies
- ✅ Game service layer with real-time subscriptions
- ✅ Create Game button creates game in database and navigates to lobby
- ✅ Join Game button adds player to game and navigates to lobby
- ✅ Available Games shows real-time list from Supabase (optimized with incremental updates)

### The Lobby Screen
- The "Game Header" is displayed (see above) at the top.
- Under this is the "Caption" component displaying game status.
- Under this is the "Player Key" (see above) **showing lifetime scores**.
  - A message below the player key states "Scores shown are lifetime scores".
- The host has a "Start Game" button (Normal) which is right justified:
  - Button is active (clickable) when at least one other player has joined the game (minimum 2 players).
  - The "Start Game" button allows the host to start a game with less than 6 players.
  - The game automatically starts when 6 players have joined the game.
  - When a game starts:
    - All players who have joined the game move to the "Entry Screen".
    - The "Join Game" button beside the game name in the "Available Games" area is disabled (made unclickable).
- All non-host players have a "Leave Game" button (see above).
- **Note:** The lobby is only shown at game creation/join. After voting rounds complete, players go directly to the Entry Screen for the next round (not back to lobby).

**Implementation Status:**
- ✅ LobbyScreen component with GameHeader, Caption, and PlayerKey
- ✅ Real-time player list updates (optimized single channel with incremental updates)
- ✅ Host "Start Game" button (validates ≥2 players, navigates to /game/{gameId}/entry)
- ✅ Auto-start when 6th player joins
- ✅ Non-host "Leave Game" button in Caption
- ✅ Host can kick players by clicking player tags (with confirmation dialog)
- ✅ Game deletion returns all players to Gathering Screen
- ✅ Refresh handling for both host and non-host players
- ✅ Caption displays player name in their color
- ✅ Gold star (★) indicates host in player list
- ✅ Full-width Caption with minimal padding (4px 20px)
- ✅ Clickable player tags for kicking (host only)
- ⚠️ Entry Screen route (/game/{gameId}/entry) not yet created

**Technical Implementation Details:**
- Caption Component: Reusable status bar showing "[Player Name] playing game [Game Name]" with action buttons
  - Full width with max-width: 800px, padding: 4px 20px
  - box-sizing: border-box to prevent overflow
  - Player name displayed in bold with their assigned color
  - Host sees "End Game" button (Danger)
  - Non-host sees "Leave Game" button (Danger)
  - Button text "Need at least 2" when < 2 players
  
- PlayerKey Component: 3-column grid display with colored backgrounds
  - Grid layout: repeat(3, 1fr) with 10px gap
  - Compact spacing: padding 0 0 12px 0, margin-top: -4px on list
  - Gold star (★) before host name (color: rgba(255, 215, 0, 1), text-shadow: 0 0 2px rgba(0, 0, 0, 0.5))
  - Score display: min-width: 30px, text-align: center (reserved for checkmark)
  - Clickable tags for host: cursor: pointer, enhanced hover effects
  - Confirmation dialog: "Are you sure you want to kick [Player Name] from the game?"
  
- Refresh Handling Pattern:
  - displayPlayer fallback: currentPlayer || players.find(p => p.user_id === user?.id)
  - Dual host detection: currentPlayer?.is_host || user?.id === game.host_id
  - Ensures UI state persists through anonymous auth refresh
  
- Layout Principles:
  - No flexbox on .lobby-screen (matches gathering screen)
  - box-sizing: border-box on all full-width containers
  - Footer positioned after content, not at viewport bottom

### The Entry Screen
- If this is a subsequent round, entries from the prior round should be cleared.
- The game header is displayed (see above).
- Under this is the player key (see above) **showing game scores**.
- Under this is a series of 6 entry fields with auto-growing text boxes that allow up to 1k of text to be entered into them.
  - Text boxes start at 36px height and grow to a maximum of 120px based on content.
  - Vertical scrolling enabled when content exceeds maximum height.
  - There is a character counter showing characters entered and remaining (x/1024) displayed below each text box.
- The 6 text box prompts are:
  - "Uncle" with placeholder text "A title".
  - "Otto" with placeholder text "A name".
  - "Splashes" with placeholder text "An active verb".
  - "Happily" with placeholder text "An adverb".
  - "In the" with placeholder text "A preposition".
  - "Bathtub" with placeholder text "A noun".
- After these is a "Submit Entries" button (normal) and right justified.
  - Button is not active (clickable) until all text boxes have received some input.
  - Upon clicking this button:
    - Clicking players is taken to the "Wait for Entries Screen".
    - A check appears beside their name in the player key.
- The host has the "End Game" button (see above).
- All other players have a leave "Leave Game" button (see above)

### The Wait for Entries Screen
- The game header is displayed (see above).
- Under this is the player key (see above) **showing game scores**.
- The host has the "End Game" button (see above).
- All other players have a "Leave Game" button (see above).
- The waiting screen automatically transitions to the voting screen when the last player submits their entries.

### The Voting Screen
- The game header is displayed (see above).
- Under this is the player key (see above) **showing game scores**.
- **Scores are reset to 0 when the voting screen loads** for each new voting round.
- For X players, there are X resulting sentences.
- Resulting sentences should have an equal representation and distribution from all players as possible.
  - No player's entry should be used more than once but all should be used at least once.
- After this are the resulting sentences with the entries from the players equally distributed throughout all of them.
  - Player entries appear highlighted in their color and when clicked they give that player +1 to their score.
  - Players cannot vote for themselves, so their contributions should not be clickable.
- **Real-time Score Updates:**
  - Scores update instantly across all players' browsers using Supabase Realtime subscriptions.
  - When any player votes/unvotes, all players see the score change immediately.
  - No polling is used - updates are event-driven via database triggers.
  - Database UPDATE operations directly modify player.score, broadcasting to all subscribed clients.
- When a player clicks on a part of a sentence contributed by another player:
  - Vote is recorded and +1 is added to that player's score.
  - If they click again the vote is removed and -1 is subtracted from that player's score.
  - Vote count displayed next to entry updates immediately for ALL players.
- **Vote counts are displayed in real-time** on each entry (e.g., "word (3)" shows 3 votes).
  - Vote counts visible to all players (not just the voter).
  - Vote counts formatted with white-space: nowrap to stay on same line as entry text.
- **Unanimous Entry Visual Indicator:**
  - When an entry receives votes from all players except the entry's author:
    - Entry is outlined with a 3px solid gold border
    - Gold glow effect applied via box-shadow: 0 0 10px rgba(255, 215, 0, 0.6)
    - Indicates exceptional entry that achieved unanimous approval
  - Status updates in real-time as votes change (appears/disappears dynamically)
  - Applies to all game sizes (not restricted to 4+ players)
- After the resulting sentences, all players have a "Done Voting" button.
- Pressing the "Done Voting" button:
  - Marks the player as ready (ready=true).
  - Button disappears and entries become non-clickable.
  - Message appears: "Waiting for other players to finish voting..."
  - Sentences remain visible with vote counts continuing to update.
  - A checkmark appears beside their name in the player key.
- **Automatic Game Flow:**
  - When all players are marked ready (all have checkmarks in player key), the host automatically increments the game round.
  - Host fetches fresh game data and increments current_round in database.
  - All players listen for round increment via real-time subscription and auto-navigate to Entry Screen.
  - This creates an infinite loop: Entry → Voting → Entry (repeat until game ends).
- **Game Termination Conditions:**
  - The host clicks the "End Game" button (see above).
  - If fewer than 2 players remain (due to disconnections or players leaving).
  - When game ends:
    - All players' game scores are saved to their lifetime totals in the user_stats table.
    - All players are returned to the "Gathering Screen".
    - The game is removed from the database.
- The host has the "End Game" button (see above).
- All other players have a "Leave Game" button (see above).

