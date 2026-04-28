// Tiny logger. Redacts apiKey-like fields per N-3 ("never logged; redacted in
// any error reports or trace output"). Use this everywhere instead of console.

const SECRET_KEY_RE = /^(api[_-]?key|authorization|x-api-key|secret|token)$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function emit(level: 'log' | 'warn' | 'error', scope: string, args: unknown[]): void {
  const safe = args.map((a) => redact(a));
  // eslint-disable-next-line no-console
  console[level](`[hermes:${scope}]`, ...safe);
}

export function makeLogger(scope: string) {
  return {
    log: (...args: unknown[]) => emit('log', scope, args),
    warn: (...args: unknown[]) => emit('warn', scope, args),
    error: (...args: unknown[]) => emit('error', scope, args),
  };
}
