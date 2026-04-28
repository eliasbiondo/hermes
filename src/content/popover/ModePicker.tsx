// First screen of the popover (F-1.4): explicit two-button mode picker.
// No heuristic / no auto-detection — user always chooses.

function ArrowIcon() {
  return (
    <svg
      className="hermes-choice__arrow"
      viewBox="0 0 14 14"
      width="14"
      height="14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 7h8M7.5 3.5 11 7l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  selectionText: string;
  remember: boolean;
  onToggleRemember: (v: boolean) => void;
  onPick: (mode: 'A' | 'B') => void;
}

export function ModePicker({ selectionText, remember, onToggleRemember, onPick }: Props) {
  const preview = selectionText.length > 80 ? selectionText.slice(0, 77) + '…' : selectionText;

  return (
    <section className="hermes-popover__step">
      <p className="hermes-popover__selection">"{preview}"</p>

      <div className="hermes-popover__choices">
        <button
          type="button"
          className="hermes-choice"
          onClick={() => onPick('A')}
          autoFocus
        >
          <span className="hermes-choice__title">
            <span>Generate a sentence for me</span>
            <ArrowIcon />
          </span>
          <span className="hermes-choice__hint">
            Treat the selection as the term. Hermes writes a fresh sentence around it.
          </span>
        </button>
        <button
          type="button"
          className="hermes-choice"
          onClick={() => onPick('B')}
        >
          <span className="hermes-choice__title">
            <span>Use my selection as the sentence</span>
            <ArrowIcon />
          </span>
          <span className="hermes-choice__hint">
            Selection is the front sentence verbatim. You'll highlight the term inside it next.
          </span>
        </button>
      </div>

      <label className="hermes-popover__remember">
        <span className={`hermes-checkbox${remember ? ' is-checked' : ''}`}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => onToggleRemember(e.target.checked)}
          />
          <span className="hermes-checkbox__box" aria-hidden="true">
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
        <span>Remember my last choice</span>
      </label>
    </section>
  );
}
