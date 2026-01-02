import React from 'react';
import './Caption.css';

interface CaptionProps {
  message: React.ReactNode;
  button?: React.ReactNode;
}

export const Caption: React.FC<CaptionProps> = ({ message, button }) => {
  return (
    <div className="caption">
      <div className="caption-message">{message}</div>
      {button && <div className="caption-button">{button}</div>}
    </div>
  );
};
