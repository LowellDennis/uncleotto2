import React from 'react';
import type { Player } from '../types/database.types';
import { PlayerBadge } from './PlayerBadge';
import './PlayerKey.css';

interface PlayerKeyProps {
  players: Player[];
  currentUserId?: string;
  showKickButton?: boolean;
  onKickPlayer?: (playerId: string) => void;
  playersReady?: Set<string>;
  showLifetimeScore?: boolean;
}

export const PlayerKey: React.FC<PlayerKeyProps> = ({
  players,
  currentUserId,
  showKickButton = false,
  onKickPlayer,
  playersReady,
  showLifetimeScore = false
}) => {
  // Sort players by join order
  const sortedPlayers = [...players].sort((a, b) => a.join_order - b.join_order);

  const handlePlayerClick = (player: Player) => {
    if (showKickButton && !player.is_host && currentUserId && player.user_id !== currentUserId) {
      const willEndGame = players.length === 2;
      const message = willEndGame 
        ? `Are you sure you want to kick ${player.name} from the game? This will end the game.`
        : `Are you sure you want to kick ${player.name} from the game?`;
      
      if (confirm(message)) {
        onKickPlayer?.(player.id);
      }
    }
  };

  return (
    <div className="player-key">
      <div className="player-list">
        {sortedPlayers.map((player) => {
          const isKickable = !!(showKickButton && !player.is_host && currentUserId && player.user_id !== currentUserId);
          const isReady = playersReady?.has(player.id) || false;
          return (
            <PlayerBadge
              key={player.id}
              player={player}
              isKickable={isKickable}
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
