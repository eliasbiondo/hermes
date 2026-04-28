import { useId } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, ariaLabel, disabled }: CheckboxProps) {
  const id = useId();
  return (
    <span className={`ui-checkbox${checked ? ' is-checked' : ''}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <span className="ui-checkbox__box" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
          <path
            d="m2.5 6.5 2.4 2.4 4.6-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}
