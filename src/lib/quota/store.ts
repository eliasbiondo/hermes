// Per-call usage log + monthly aggregator (F-5.5). Each LLM/TTS call gets a
// row; the dashboard sums them by month. Lives in a separate Dexie table so
// it can be cleared without touching cards.

import Dexie, { type EntityTable } from 'dexie';

export interface UsageRecord {
  id: string;
  ts: number;
  kind: 'llm' | 'tts';
  provider: string;
  model?: string;
  voiceId?: string;
  inputChars?: number;
  outputChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  estCostUSD?: number;
}

class QuotaDB extends Dexie {
  usage!: EntityTable<UsageRecord, 'id'>;
  constructor() {
    super('hermes-quota');
    this.version(1).stores({ usage: '&id, ts, kind, provider, model' });
  }
}

let _db: QuotaDB | null = null;
function db(): QuotaDB {
  if (!_db) _db = new QuotaDB();
  return _db;
}

export async function recordUsage(rec: Omit<UsageRecord, 'id'>): Promise<void> {
  await db().usage.put({ ...rec, id: `${rec.ts}-${Math.random().toString(36).slice(2, 8)}` });
}

export interface MonthlySummary {
  month: string;
  llmCalls: number;
  ttsCalls: number;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
  outputChars: number;
  estCostUSD: number;
}

export async function summarizeMonth(yearMonth: string): Promise<MonthlySummary> {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) throw new Error('summarizeMonth: bad month');
  const start = new Date(y, m - 1, 1).getTime();
  const end = new Date(y, m, 1).getTime();
  const rows = await db().usage.where('ts').between(start, end, true, false).toArray();

  let llmCalls = 0;
  let ttsCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let inputChars = 0;
  let outputChars = 0;
  let estCostUSD = 0;
  for (const r of rows) {
    if (r.kind === 'llm') llmCalls++;
    if (r.kind === 'tts') ttsCalls++;
    inputTokens += r.inputTokens ?? 0;
    outputTokens += r.outputTokens ?? 0;
    inputChars += r.inputChars ?? 0;
    outputChars += r.outputChars ?? 0;
    estCostUSD += r.estCostUSD ?? 0;
  }
  return {
    month: yearMonth,
    llmCalls,
    ttsCalls,
    inputTokens,
    outputTokens,
    inputChars,
    outputChars,
    estCostUSD,
  };
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function listMonths(): Promise<string[]> {
  const rows = await db().usage.toArray();
  const set = new Set<string>();
  for (const r of rows) {
    const d = new Date(r.ts);
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const arr = [...set].sort().reverse();
  if (!arr.includes(currentMonth())) arr.unshift(currentMonth());
  return arr;
}
