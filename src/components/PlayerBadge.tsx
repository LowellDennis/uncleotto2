import React from 'react';
import type { Player } from '../types/database.types';
import './PlayerBadge.css';

interface PlayerBadgeProps {
  player: Player;
  isKickable?: boolean;
  onClick?: () => void;
  showReady?: boolean;
  showLifetimeScore?: boolean;
}

export const PlayerBadge: React.FC<PlayerBadgeProps> = ({
  player,
  isKickable = false,
  onClick,
  showReady = false,
  showLifetimeScore = false
}) => {
  return (
    <div 
      className={`player-badge${isKickable ? ' player-badge-kickable' : ''}`}
      style={{ backgroundColor: player.color }}
      onClick={onClick}
    >
      <span className="player-badge-name">
        {player.is_host && <span className="host-badge">★</span>}
        {player.name}
      </span>
      <span className="player-badge-score">
        {showLifetimeScore ? player.lifetime_score : player.score}
        {showReady && <span className="ready-indicator">✓</span>}
      </span>
    </div>
  );
};
