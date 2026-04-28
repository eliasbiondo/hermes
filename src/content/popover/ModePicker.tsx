// First screen of the popover (F-1.4): explicit two-button mode picker.
// No heuristic / no auto-detection — user always chooses.

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
          <span className="hermes-choice__title">Generate a sentence for me</span>
          <span className="hermes-choice__hint">
            Treat the selection as the term. Hermes writes a fresh English sentence around it.
          </span>
        </button>
        <button
          type="button"
          className="hermes-choice"
          onClick={() => onPick('B')}
        >
          <span className="hermes-choice__title">Use my selection as the sentence</span>
          <span className="hermes-choice__hint">
            Selection is the front sentence verbatim. You'll highlight the term inside it next.
          </span>
        </button>
      </div>

      <label className="hermes-popover__remember">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => onToggleRemember(e.target.checked)}
        />
        <span>Remember my last choice</span>
      </label>
    </section>
  );
}
