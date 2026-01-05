import React from 'react';
import type { Player } from '../types/database.types';
import { PlayerBadge } from './PlayerBadge';
import './PlayerKey.css';

interface PlayerKeyProps {
  players: Player[];
  currentUserId?: string;
  showKickButton?: boolean;
  onKickPlayer?: (playerId: string) => void;
  onTakeOverHost?: () => void;
  playersReady?: Set<string>;
  showLifetimeScore?: boolean;
}

export const PlayerKey: React.FC<PlayerKeyProps> = ({
  players,
  currentUserId,
  showKickButton = false,
  onKickPlayer,
  onTakeOverHost,
  playersReady,
  showLifetimeScore = false
}) => {
  // Sort players: host first, then by join order
  const sortedPlayers = [...players].sort((a, b) => {
    // Host always first
    if (a.is_host && !b.is_host) return -1;
    if (!a.is_host && b.is_host) return 1;
    // Otherwise sort by join order
    return a.join_order - b.join_order;
  });

  const handlePlayerClick = (player: Player) => {
    // Host clicking on other players (kick functionality)
    if (showKickButton && !player.is_host && currentUserId && player.user_id !== currentUserId) {
      const willEndGame = players.length === 2;
      const message = willEndGame 
        ? `If you kick ${player.name} from the game there will not be enough to continue. Are you sure?`
        : `Are you sure you want to kick ${player.name} from the game?`;
      
      if (confirm(message)) {
        onKickPlayer?.(player.id);
      }
    }
    // Non-host clicking on host (take over functionality)
    else if (!showKickButton && player.is_host && onTakeOverHost && currentUserId && player.user_id !== currentUserId) {
      const message = `The host (${player.name}) appears to be inactive. Do you want to take over as host?`;
      
      if (confirm(message)) {
        onTakeOverHost();
      }
    }
  };

  return (
    <div className="player-key">
      <div className="player-list">
        {sortedPlayers.map((player) => {
          const isKickable = !!(showKickButton && !player.is_host && currentUserId && player.user_id !== currentUserId);
          const isTakeOverable = !!(!showKickButton && player.is_host && onTakeOverHost && currentUserId && player.user_id !== currentUserId);
          const isReady = playersReady?.has(player.id) || false;
          return (
            <PlayerBadge
              key={player.id}
              player={player}
              isKickable={isKickable || isTakeOverable}
              onClick={() => handlePlayerClick(player)}
              showReady={isReady}
              showLifetimeScore={!!showLifetimeScore}
            />
          );
        })}
      </div>
    </div>
  );
};
