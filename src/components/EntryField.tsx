import React from 'react';
import './EntryField.css';

interface EntryFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  maxChars: number;
  onChange: (value: string) => void;
}

export const EntryField: React.FC<EntryFieldProps> = ({
  id,
  label,
  value,
  placeholder,
  maxChars,
  onChange
}) => {
  return (
    <div className="entry-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={1}
        />
        <span className="char-counter">{value.length}/{maxChars}</span>
      </div>
    </div>
  );
};
