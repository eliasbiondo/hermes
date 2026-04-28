import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

interface SelectProps<V extends string> {
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  ariaLabel?: string;
  width?: number | string;
  disabled?: boolean;
  size?: 'md' | 'sm';
  variant?: 'default' | 'chip';
  align?: 'start' | 'end';
}

export function Select<V extends string>({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  ariaLabel,
  width,
  disabled,
  size = 'md',
  variant = 'default',
  align = 'start',
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const [activeIndex, setActiveIndex] = useState<number>(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );

  useEffect(() => {
    if (open) {
      setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  }, [open, options, value]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        listRef.current?.contains(t)
      ) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Scroll active option into view when navigating with keyboard.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) {
        onChange(opt.value);
        close();
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const rootClass = [
    'ui-select',
    size === 'sm' ? 'ui-select--sm' : '',
    variant === 'chip' ? 'ui-select--chip' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass} style={width ? { width } : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className={`ui-select__trigger${open ? ' is-open' : ''}${
          value ? ' has-value' : ''
        }`}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className={`ui-select__value${selected ? '' : ' is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="ui-select__caret" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 4l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div
          id={`${id}-list`}
          role="listbox"
          ref={(el) => {
            listRef.current = el;
            el?.focus();
          }}
          tabIndex={-1}
          className={`ui-select__panel ui-select__panel--${align}`}
          onKeyDown={onListKey}
        >
          <div className="ui-select__listbox">
            {options.map((o, i) => {
              const isActive = i === activeIndex;
              const isSelected = o.value === value;
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  className={`ui-select__option${isActive ? ' is-active' : ''}${
                    isSelected ? ' is-selected' : ''
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    onChange(o.value);
                    close();
                  }}
                >
                  <span className="ui-select__option-check" aria-hidden="true">
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path
                          d="m2.5 6.5 2.5 2.5L9.5 3.5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="ui-select__option-label">{o.label}</span>
                  {o.hint && <span className="ui-select__option-hint">{o.hint}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
