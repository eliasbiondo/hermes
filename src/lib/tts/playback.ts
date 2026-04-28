// Tiny audio playback helper for the popover preview + card list (F-3.5).

import { getBlobUrl } from './audio-cache';

let current: HTMLAudioElement | null = null;

export async function play(blobId: string): Promise<void> {
  stop();
  const url = await getBlobUrl(blobId);
  if (!url) return;
  current = new Audio(url);
  current.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  await current.play();
}

export function stop(): void {
  if (!current) return;
  current.pause();
  current = null;
}
