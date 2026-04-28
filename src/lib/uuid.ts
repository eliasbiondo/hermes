export function uuid(): string {
  // crypto.randomUUID is available in MV3 SW, content scripts, and modern web.
  return crypto.randomUUID();
}

export function ankiGuidFor(cardId: string): string {
  // F-6.6: deterministic GUID so re-export updates the existing note.
  return `hermes::${cardId}`;
}
