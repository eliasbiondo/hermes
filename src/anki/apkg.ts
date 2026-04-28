// .apkg builder. Anki's package format is:
//   - JSZip containing:
//     - "collection.anki2" — SQLite DB with collection schema
//     - "media" — JSON map "{ '0': 'filename.mp3', ... }"
//     - "0", "1", ... — the actual media files (numeric indexes from media)
//
// We bundle a custom note type ("Hermes Card") in the col.models JSON so the
// import installs templates + CSS automatically (F-6.2). Cards use a
// deterministic GUID `hermes::<card.id>` (F-6.6) so re-import updates rather
// than duplicates.

import JSZip from 'jszip';
import initSqlJs, { type Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {
  HERMES_BACK_TEMPLATE,
  HERMES_CSS,
  HERMES_DECK_ID,
  HERMES_FIELDS,
  HERMES_FRONT_TEMPLATE,
  HERMES_MODEL_ID,
  HERMES_NOTE_TYPE_NAME,
} from './note-type';
import { audioFilename, fieldsForCard } from './render';
import { fetchAudioBytes } from '@/lib/tts/audio-cache';
import { ankiGuidFor } from '@/lib/uuid';
import type { Card } from '@/types/card';

const ANKI_SCHEMA = `
CREATE TABLE col (
  id integer PRIMARY KEY, crt integer, mod integer, scm integer,
  ver integer, dty integer, usn integer, ls integer,
  conf text, models text, decks text, dconf text, tags text);
CREATE TABLE notes (
  id integer PRIMARY KEY, guid text, mid integer, mod integer,
  usn integer, tags text, flds text, sfld text, csum integer,
  flags integer, data text);
CREATE TABLE cards (
  id integer PRIMARY KEY, nid integer, did integer, ord integer,
  mod integer, usn integer, type integer, queue integer, due integer,
  ivl integer, factor integer, reps integer, lapses integer, left integer,
  odue integer, odid integer, flags integer, data text);
CREATE TABLE revlog (
  id integer PRIMARY KEY, cid integer, usn integer, ease integer,
  ivl integer, lastIvl integer, factor integer, time integer, type integer);
CREATE TABLE graves (usn integer, oid integer, type integer);
CREATE INDEX ix_notes_usn  ON notes (usn);
CREATE INDEX ix_cards_usn  ON cards (usn);
CREATE INDEX ix_cards_nid  ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_revlog_usn ON revlog (usn);
`;

interface BuildResult {
  blob: Blob;
  exportedCardIds: string[];
  filename: string;
}

export async function buildApkg(
  deckName: string,
  cards: Card[],
): Promise<BuildResult> {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const db = new SQL.Database();
  db.exec(ANKI_SCHEMA);

  const now = Math.floor(Date.now() / 1000);
  insertCol(db, deckName, now);

  const media = new Map<string, Uint8Array>();
  const exportedCardIds: string[] = [];

  for (const card of cards) {
    const flds = fieldsForCard(card);
    const fieldsJoined = HERMES_FIELDS.map((f) => flds[f]).join('\x1f');
    const guid = ankiGuidFor(card.id);
    const noteId = numericIdFromString(guid);
    const sfld = card.term;

    db.run(
      `INSERT OR REPLACE INTO notes
       (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`,
      [
        noteId,
        guid,
        HERMES_MODEL_ID,
        now,
        ` ${card.tags.join(' ')} `,
        fieldsJoined,
        sfld,
        fieldChecksum(card.term),
      ],
    );

    db.run(
      `INSERT OR REPLACE INTO cards
       (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor,
        reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      [noteId + 1, noteId, HERMES_DECK_ID, now, exportedCardIds.length + 1],
    );

    if (card.sentenceAudioBlobId) {
      const bytes = await fetchAudioBytes(card.sentenceAudioBlobId);
      if (bytes) media.set(audioFilename(card, 'sentence'), bytes);
    }
    if (card.termAudioBlobId) {
      const bytes = await fetchAudioBytes(card.termAudioBlobId);
      if (bytes) media.set(audioFilename(card, 'term'), bytes);
    }

    exportedCardIds.push(card.id);
  }

  const dbBytes = db.export();
  db.close();

  const zip = new JSZip();
  zip.file('collection.anki2', dbBytes);

  const mediaIndex: Record<string, string> = {};
  let i = 0;
  for (const [name, bytes] of media) {
    mediaIndex[String(i)] = name;
    zip.file(String(i), bytes);
    i++;
  }
  zip.file('media', JSON.stringify(mediaIndex));

  // Anki's .apkg is a zip under the hood, but if the blob's MIME is
  // application/zip Chrome rewrites the download to .zip regardless of the
  // suggested filename. application/octet-stream forces Chrome to honour
  // the .apkg extension so Anki recognises the file on double-click.
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream' });
  return {
    blob,
    exportedCardIds,
    filename: `export-${todayStamp()}.apkg`,
  };
}

function insertCol(db: Database, deckName: string, now: number): void {
  const models = {
    [HERMES_MODEL_ID]: {
      id: HERMES_MODEL_ID,
      name: HERMES_NOTE_TYPE_NAME,
      type: 0,
      mod: now,
      usn: 0,
      sortf: 2, // sort by Term
      did: HERMES_DECK_ID,
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: HERMES_FRONT_TEMPLATE,
          afmt: HERMES_BACK_TEMPLATE,
          bqfmt: '',
          bafmt: '',
          did: null,
        },
      ],
      flds: HERMES_FIELDS.map((name, ord) => ({
        name,
        ord,
        sticky: false,
        rtl: false,
        font: 'Arial',
        size: 20,
        media: [],
      })),
      css: HERMES_CSS,
      latexPre: '',
      latexPost: '',
      tags: [],
      vers: [],
      req: [[0, 'all', [0, 2]]],
    },
  };
  const decks = {
    1: {
      id: 1,
      name: 'Default',
      mod: now,
      usn: 0,
      desc: '',
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
      collapsed: true,
      browserCollapsed: true,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
      dyn: 0,
    },
    [HERMES_DECK_ID]: {
      id: HERMES_DECK_ID,
      name: deckName,
      mod: now,
      usn: 0,
      desc: '',
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
      dyn: 0,
    },
  };
  const conf = {
    nextPos: 1,
    estTimes: true,
    activeDecks: [HERMES_DECK_ID],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: HERMES_DECK_ID,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: HERMES_MODEL_ID,
    collapseTime: 1200,
  };
  const dconf = {
    1: {
      id: 1,
      name: 'Default',
      mod: 0,
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20, bury: true },
      rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: true, hardFactor: 1.2 },
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
      dyn: false,
      autoplay_q: true,
    },
  };

  db.run(
    `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
     VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`,
    [
      now,
      now,
      now,
      JSON.stringify(conf),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify(dconf),
    ],
  );
}

function numericIdFromString(s: string): number {
  // Stable 53-bit hash so re-exports of the same card.id reuse the same
  // notes.id row (F-6.6 update-on-reimport).
  let h = 5381n;
  for (const ch of s) h = ((h << 5n) + h + BigInt(ch.charCodeAt(0))) & 0x1fffffffffffffn;
  return Number(h) || 1;
}

function fieldChecksum(s: string): number {
  // Anki uses sha1 first 8 hex digits; a small djb2-like hash is acceptable
  // for new notes since this column is only used for duplicate detection
  // inside the same model.
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}
