// U-8: human-readable, actionable error messages. Map common provider /
// network failures to friendly copy with a hint.

export function humanizeError(raw: string): string {
  const m = raw.match(/HTTP (\d{3})/);
  if (m) {
    const code = m[1];
    switch (code) {
      case '401':
        return 'API key was rejected. Open settings and re-paste it.';
      case '403':
        return 'Provider refused the request — check your account or quota.';
      case '404':
        return 'Provider endpoint not found — the model name may be wrong.';
      case '429':
        return "You've hit the provider's rate limit. Wait a minute and retry.";
      case '500':
      case '502':
      case '503':
      case '504':
        return 'Provider had a server error — try again in a moment.';
    }
  }
  if (/network/i.test(raw) || /fetch/i.test(raw)) {
    return 'Network error reaching the provider — check your connection.';
  }
  if (/timeout|exceeded.*soft timeout/i.test(raw)) {
    return 'Run took too long — saved partial result; you can regenerate.';
  }
  return raw;
}
