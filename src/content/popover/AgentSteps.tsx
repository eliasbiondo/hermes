// Streams the agent's tool calls into the popover (F-2.3, U-4). One labeled
// step per tool, with status dots that update as `tool_start`/`tool_end`/
// `tool_error` events arrive.

import type { AgentStreamEvent } from '@/types/messages';
import { humanizeError } from '@/lib/errors/messages';

type StepStatus = 'pending' | 'running' | 'done' | 'failed';

interface Props {
  events: AgentStreamEvent[];
  done: boolean;
  result?: { status: 'complete' | 'partial' | 'failed'; error?: string };
}

const STEP_LABELS: Record<string, string> = {
  enrich: 'Drafting card',
  tts_synthesize: 'Synthesizing audio',
  tts_synthesize_term: 'Synthesizing term audio',
  // Keep older labels around so historical queue entries still read nicely.
  classify_term: 'Classifying',
  generate_sentence: 'Writing sentence',
  translate_sentence: 'Translating',
  validate_alignment: 'Checking alignment',
  translate_term: 'Translating term',
};

export function AgentSteps({ events, done, result }: Props) {
  const steps = aggregateSteps(events);

  return (
    <section className="hermes-popover__step">
      <ul className="hermes-steps" aria-live="polite">
        {steps.map((s, i) => (
          <li key={i} className={`hermes-step is-${s.status}`}>
            <span className="hermes-step__dot" aria-hidden="true" />
            <span className="hermes-step__label">{STEP_LABELS[s.name] ?? s.name}</span>
            {s.durationMs !== undefined && s.status === 'done' && (
              <span className="hermes-step__time">{s.durationMs} ms</span>
            )}
            {s.error && <span className="hermes-step__err">{humanizeError(s.error)}</span>}
          </li>
        ))}
      </ul>

      {done && result && (
        <p
          className={result.status === 'complete' ? 'is-ok' : 'is-err'}
          role={result.status === 'complete' ? 'status' : 'alert'}
        >
          {result.status === 'complete'
            ? 'Done — card saved.'
            : result.error
              ? humanizeError(result.error)
              : 'Run finished without producing a card.'}
        </p>
      )}
    </section>
  );
}

function aggregateSteps(events: AgentStreamEvent[]): Array<{
  name: string;
  status: StepStatus;
  durationMs?: number;
  error?: string;
}> {
  // Key by tool + start timestamp so retries (e.g. translate_sentence after a
  // failed validate_alignment) land in their own row instead of flipping the
  // first call's green dot back to blue.
  const map = new Map<string, { name: string; status: StepStatus; durationMs?: number; error?: string }>();
  const orderMap = new Map<string, number>();
  let order = 0;
  for (const e of events) {
    if (e.kind === 'result') continue;
    const key = `${e.tool}@${e.at}`;
    if (!orderMap.has(key)) orderMap.set(key, order++);
    const cur = map.get(key) ?? { name: e.tool, status: 'pending' as StepStatus };
    if (e.kind === 'tool_start') cur.status = 'running';
    else if (e.kind === 'tool_end') {
      cur.status = 'done';
      cur.durationMs = e.durationMs;
    } else if (e.kind === 'tool_error') {
      cur.status = 'failed';
      cur.error = e.error;
    }
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0))
    .map(([, v]) => v);
}
