// Microsoft "Edge Read Aloud" TTS over WebSocket. Same neural voices as the
// Edge browser's read-aloud feature. No API key required — the service
// trusts a fixed public client token. Returns MP3 directly so it lands in
// Anki without re-encoding (F-3.6).

import { uuid } from '@/lib/uuid';
import type { TTSProvider, Voice } from './types';

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WS_BASE =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
  `?TrustedClientToken=${TRUSTED_TOKEN}`;
const VOICES_URL =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list' +
  `?trustedclienttoken=${TRUSTED_TOKEN}`;
// Edge browser version Microsoft expects in the Sec-MS-GEC-Version param.
// Bumped occasionally upstream; mid-2024+ value works for current servers.
const EDGE_VERSION = '1-130.0.2849.68';

// Sec-MS-GEC: SHA-256 of (rounded Windows file-time + token), uppercase hex.
// Microsoft started requiring this in 2024 to gate the public TTS endpoint;
// without it the WebSocket handshake is rejected (the browser surfaces only
// a generic "WebSocket error" because the close reason is opaque).
async function computeSecMsGec(): Promise<string> {
  const unixSec = Math.floor(Date.now() / 1000);
  // Windows file-time epoch (1601-01-01) → Unix epoch shift, in 100ns ticks.
  const ticks = (unixSec + 11_644_473_600) * 10_000_000;
  // Round down to the nearest 5-minute window (3e9 ticks) per upstream impl.
  const rounded = Math.floor(ticks / 3_000_000_000) * 3_000_000_000;
  const data = new TextEncoder().encode(`${rounded}${TRUSTED_TOKEN}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function buildWsUrl(): Promise<string> {
  const gec = await computeSecMsGec();
  const cid = (crypto.randomUUID?.() ?? '').replace(/-/g, '') || randomHex(32);
  const params = new URLSearchParams({
    'Sec-MS-GEC': gec,
    'Sec-MS-GEC-Version': EDGE_VERSION,
    ConnectionId: cid,
  });
  return `${WS_BASE}&${params.toString()}`;
}

function randomHex(n: number): string {
  const b = new Uint8Array(n / 2);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Curated short list shown in the Settings dropdown. The full catalogue is
// fetched on demand via listVoices(); these are the well-known en-US/en-GB
// neural voices that consistently sound natural.
const FEATURED_VOICES: Voice[] = [
  { id: 'en-US-AriaNeural', name: 'Aria (US, female)', language: 'en-US' },
  { id: 'en-US-JennyNeural', name: 'Jenny (US, female)', language: 'en-US' },
  { id: 'en-US-GuyNeural', name: 'Guy (US, male)', language: 'en-US' },
  { id: 'en-US-AndrewNeural', name: 'Andrew (US, male)', language: 'en-US' },
  { id: 'en-US-EmmaNeural', name: 'Emma (US, female)', language: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (UK, female)', language: 'en-GB' },
  { id: 'en-GB-RyanNeural', name: 'Ryan (UK, male)', language: 'en-GB' },
];

export class EdgeTTS implements TTSProvider {
  async synthesize(text: string, voiceId: string): Promise<Blob> {
    const url = await buildWsUrl();
    return new Promise<Blob>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      const audioChunks: Uint8Array[] = [];
      const requestId = uuid().replace(/-/g, '');
      let settled = false;
      let lastCloseCode = 0;
      let lastCloseReason = '';

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* noop */ }
        reject(err);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* noop */ }
        const total = audioChunks.reduce((n, c) => n + c.byteLength, 0);
        if (total === 0) {
          reject(new Error('Edge TTS returned no audio'));
          return;
        }
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of audioChunks) {
          merged.set(c, off);
          off += c.byteLength;
        }
        const ab = new ArrayBuffer(merged.byteLength);
        new Uint8Array(ab).set(merged);
        resolve(new Blob([ab], { type: 'audio/mpeg' }));
      };

      const timeout = setTimeout(() => fail(new Error('Edge TTS timeout (30s)')), 30_000);

      ws.onopen = () => {
        ws.send(buildConfigMessage());
        ws.send(buildSSMLMessage(requestId, voiceId, text));
      };

      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          if (/Path:\s*turn\.end/i.test(e.data)) {
            clearTimeout(timeout);
            finish();
          }
          return;
        }
        const data = e.data as ArrayBuffer;
        const view = new DataView(data);
        const headerLen = view.getUint16(0, false);
        const audio = new Uint8Array(data, 2 + headerLen);
        if (audio.byteLength) audioChunks.push(audio);
      };

      // The browser fires onerror with no detail (security), then onclose
      // with a code/reason. We delay the rejection to onclose so we can
      // surface those — much more useful than a bare "WebSocket error".
      ws.onerror = () => { /* wait for onclose */ };

      ws.onclose = (ev) => {
        clearTimeout(timeout);
        lastCloseCode = ev.code;
        lastCloseReason = ev.reason;
        if (!settled) {
          const reason = lastCloseReason ? ` "${lastCloseReason}"` : '';
          fail(new Error(`Edge TTS closed before turn.end (code ${lastCloseCode}${reason})`));
        }
      };
    });
  }

  async listVoices(): Promise<Voice[]> {
    try {
      const r = await fetch(VOICES_URL);
      if (!r.ok) return FEATURED_VOICES;
      const all = (await r.json()) as Array<{
        ShortName: string;
        FriendlyName?: string;
        DisplayName?: string;
        Locale?: string;
        Gender?: string;
      }>;
      // Keep English-locale neural voices, sorted with featured ones first.
      const en = all
        .filter((v) => (v.Locale ?? '').toLowerCase().startsWith('en-'))
        .map<Voice>((v) => ({
          id: v.ShortName,
          name: `${v.DisplayName ?? v.ShortName}${v.Gender ? ` (${v.Locale}, ${v.Gender.toLowerCase()})` : ''}`,
          ...(v.Locale ? { language: v.Locale } : {}),
        }));
      const featuredIds = new Set(FEATURED_VOICES.map((v) => v.id));
      const featured = FEATURED_VOICES.filter((v) => en.some((x) => x.id === v.id));
      const rest = en.filter((v) => !featuredIds.has(v.id));
      return [...featured, ...rest];
    } catch {
      return FEATURED_VOICES;
    }
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = performance.now();
    try {
      const r = await fetch(VOICES_URL);
      return { ok: r.ok, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: 0 };
    }
  }
}

function buildConfigMessage(): string {
  const ts = new Date().toISOString();
  const body = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: 'false',
            wordBoundaryEnabled: 'false',
          },
          // Plain MP3 — no transcoding needed downstream.
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        },
      },
    },
  });
  return [
    `X-Timestamp:${ts}`,
    'Content-Type:application/json; charset=utf-8',
    'Path:speech.config',
    '',
    body,
  ].join('\r\n');
}

function buildSSMLMessage(requestId: string, voiceId: string, text: string): string {
  const ts = new Date().toISOString();
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voiceId}'>` +
    `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;
  return [
    `X-RequestId:${requestId}`,
    'Content-Type:application/ssml+xml',
    `X-Timestamp:${ts}`,
    'Path:ssml',
    '',
    ssml,
  ].join('\r\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
