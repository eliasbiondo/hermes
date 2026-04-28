import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ModePicker } from './ModePicker';
import { SubSelection } from './SubSelection';
import { AgentSteps } from './AgentSteps';
import type { AgentStreamEvent, CapturePayload } from '@/types/messages';
import type { CaptureMode } from '@/types/card';

export interface PopoverProps {
  anchorRect: DOMRect;
  payload: CapturePayload;
  rememberLastMode: boolean;
  lastMode?: 'A' | 'B';
  onSubmit: (mode: CaptureMode, opts: { sentence?: string; termSpan?: { start: number; end: number } }) => Promise<string | null>;
  onClose: () => void;
}

export function Popover(props: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'pick' | 'A' | 'B' | 'running' | 'toast'>(
    props.rememberLastMode && props.lastMode ? props.lastMode : 'pick',
  );
  const [remember, setRemember] = useState(props.rememberLastMode);
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [result, setResult] = useState<{ status: 'complete' | 'partial' | 'failed'; error?: string } | null>(null);

  useEffect(() => {
    if (!runId) return;
    const handler = (msg: { kind?: string; event?: AgentStreamEvent }) => {
      if (msg.kind !== 'agent-event' || !msg.event || msg.event.runId !== runId) return;
      setEvents((prev) => [...prev, msg.event!]);
      if (msg.event.kind === 'result') {
        setResult({ status: msg.event.status, ...(msg.event.error ? { error: msg.event.error } : {}) });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [runId]);

  // Once a result comes in, auto-dismiss the toast after a short read window.
  useEffect(() => {
    if (mode !== 'toast' || !result) return;
    const t = window.setTimeout(() => props.onClose(), result.status === 'complete' ? 2500 : 6000);
    return () => window.clearTimeout(t);
  }, [mode, result, props]);

  const submit = async (
    cm: CaptureMode,
    opts: { sentence?: string; termSpan?: { start: number; end: number } },
  ) => {
    // Don't park the popover next to the selection during the long agent run —
    // collapse to a small bottom-right toast so the user can keep reading.
    setMode('toast');
    const id = await props.onSubmit(cm, opts);
    if (id) setRunId(id);
  };

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      // Once we've collapsed to the bottom-right toast, clicks elsewhere on
      // the page should NOT dismiss it — the user expects the run to keep
      // streaming until they hit the X.
      if (mode === 'toast') return;
      const path = e.composedPath();
      if (ref.current && !path.includes(ref.current)) props.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onClickOutside, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onClickOutside, true);
      previouslyFocused?.focus?.();
    };
  }, [props, mode]);

  const isToast = mode === 'toast';
  const [pos, setPos] = useState(() => computePosition(props.anchorRect));

  useLayoutEffect(() => {
    if (isToast || !ref.current) return;
    const el = ref.current;
    const next = computePosition(props.anchorRect, el.offsetWidth, el.offsetHeight);
    setPos(next);
    const ro = new ResizeObserver(() => {
      const r = computePosition(props.anchorRect, el.offsetWidth, el.offsetHeight);
      setPos(r);
    });
    ro.observe(el);
    const onResize = () => {
      setPos(computePosition(props.anchorRect, el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [isToast, props.anchorRect]);

  const containerStyle: React.CSSProperties = isToast
    ? {} // .hermes-popover.is-toast handles fixed bottom-right positioning.
    : { top: `${pos.top}px`, left: `${pos.left}px` };

  return (
    <div
      ref={ref}
      className={`hermes-popover${isToast ? ' is-toast' : ''}`}
      role={isToast ? 'status' : 'dialog'}
      aria-label="Hermes capture"
      aria-live={isToast ? 'polite' : undefined}
      style={containerStyle}
    >
      <header className="hermes-popover__header">
        <strong>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 18 19"
            width="14"
            height="15"
            fill="currentColor"
            className="hermes-popover__brand"
            aria-hidden="true"
          >
            <path d="M3.65786 18.9999H0.0349086H0L4.6864 10.725H16.4108L13.3178 16.1864H9.66796L11.6176 12.7438H7.20091L3.65786 18.9999Z" />
            <path d="M14.3421 -5.72205e-05H17.9651H18L13.3136 8.2749H1.58924L4.68223 2.8135H8.33204L6.38241 6.25605H10.7991L14.3421 -5.72205e-05Z" />
          </svg>
          {isToast ? `Hermes — ${truncate(props.payload.selectionText, 28)}` : 'Hermes'}
        </strong>
        <button type="button" aria-label="Close" onClick={props.onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {mode === 'pick' && (
        <ModePicker
          selectionText={props.payload.selectionText}
          remember={remember}
          onToggleRemember={setRemember}
          onPick={(m) => {
            if (remember) {
              void chrome.runtime.sendMessage({ kind: 'remember-last-mode', mode: m });
            }
            if (m === 'A') {
              void submit('A_generated', {});
            } else {
              setMode('B');
            }
          }}
        />
      )}

      {mode === 'B' && (
        <SubSelection
          sentence={props.payload.selectionText}
          onConfirm={(termSpan) =>
            void submit('B_verbatim', {
              sentence: props.payload.selectionText,
              termSpan,
            })
          }
          onBack={() => setMode('pick')}
        />
      )}

      {(mode === 'running' || mode === 'toast') && (
        <AgentSteps
          events={events}
          done={Boolean(result)}
          {...(result ? { result } : {})}
        />
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function computePosition(
  rect: DOMRect,
  width = 380,
  height = 280,
): { top: number; left: number } {
  const edge = 12;     // distance from popover to viewport edge
  const offset = 20;   // distance from popover to the anchor selection rect
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(width, vw - edge * 2);
  const h = Math.min(height, vh - edge * 2);

  const spaceBelow = vh - rect.bottom;
  const placeBelow = spaceBelow >= h + offset;

  let top = placeBelow ? rect.bottom + offset : rect.top - h - offset;
  top = Math.max(edge, Math.min(top, vh - h - edge));

  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(edge, Math.min(left, vw - w - edge));

  return { top, left };
}
