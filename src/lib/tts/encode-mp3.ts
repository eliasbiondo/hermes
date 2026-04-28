// Tiny PCM → MP3 encoder used by the browser-TTS path. lamejs is dynamically
// imported so it only enters the bundle when browser TTS is actually used.
// Anki requires MP3 for cross-platform compatibility (F-3.6, N-8).

const SAMPLE_RATE = 44100;
const BITRATE_KBPS = 128;

export async function pcmToMp3(samples: Float32Array): Promise<Uint8Array> {
  const lame = await import('@breezystack/lamejs');
  const Mp3Encoder = (lame as unknown as { Mp3Encoder: new (channels: number, sampleRate: number, bitRate: number) => {
    encodeBuffer: (left: Int16Array) => Uint8Array;
    flush: () => Uint8Array;
  } }).Mp3Encoder;

  const encoder = new Mp3Encoder(1, SAMPLE_RATE, BITRATE_KBPS);
  const int16 = floatToInt16(samples);

  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  for (let i = 0; i < int16.length; i += blockSize) {
    const block = int16.subarray(i, Math.min(i + blockSize, int16.length));
    const out = encoder.encodeBuffer(block);
    if (out.length) chunks.push(out);
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(tail);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return merged;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function decodeAudioBlobToMonoPCM(blob: Blob): Promise<Float32Array> {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  try {
    const buf = await blob.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    if (audio.numberOfChannels === 1) {
      // Resample if needed to SAMPLE_RATE.
      return audio.sampleRate === SAMPLE_RATE
        ? audio.getChannelData(0).slice()
        : resample(audio.getChannelData(0), audio.sampleRate, SAMPLE_RATE);
    }
    const left = audio.getChannelData(0);
    const right = audio.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i]! + right[i]!) * 0.5;
    return audio.sampleRate === SAMPLE_RATE ? mono : resample(mono, audio.sampleRate, SAMPLE_RATE);
  } finally {
    void ctx.close();
  }
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = idx - lo;
    out[i] = input[lo]! * (1 - frac) + input[hi]! * frac;
  }
  return out;
}
