// Settings persistence (chrome.storage.local). Never `sync` — N-3 forbids
// API keys leaving the local machine.

import { DEFAULT_SETTINGS, type Settings } from '@/types/settings';

const KEY = 'hermes:settings:v1';

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (typeof base !== 'object' || base === null) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object') {
      out[k] = deepMerge(cur as object, v as object);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  const stored = (got[KEY] ?? {}) as Partial<Settings>;
  return deepMerge(DEFAULT_SETTINGS, stored);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = deepMerge(current, patch);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(KEY in changes)) return;
    cb(deepMerge(DEFAULT_SETTINGS, (changes[KEY]?.newValue ?? {}) as Partial<Settings>));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
