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
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '36px'; // Reset to min height
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = Math.min(scrollHeight, 120) + 'px';
    }
  }, [value]);

  return (
    <div className="entry-field">
      <div className="entry-field-row">
        <label htmlFor={id}>{label}</label>
        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={1}
          />
          <span className="char-counter">{value.length}/{maxChars}</span>
        </div>
      </div>
    </div>
  );
};
