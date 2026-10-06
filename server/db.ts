import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newUserId, tokenHash, type User } from "./auth.ts";
import { itemKey, SIMILAR_ENOUGH, similarity } from "./match.ts";

// Everything that persists lives in one SQLite file on the Fly volume (/data
// in the image; ./data when run locally). Prices are integer cents.

export const STOCK_LEVELS = ["plenty", "some", "few", "gone"] as const;
export const SOURCES = ["in-store", "store-website", "catalogue", "word-of-mouth"] as const;
// The fields a correction can change. Stock isn't one: anyone can already set it.
export const CORRECTABLE = ["item", "wasCents", "nowCents", "endsOn"] as const;
// This many different people (not the poster) proposing the same new value
// for the same field rewrites the deal. The poster's own correction applies at once.
export const CORRECTION_QUORUM = 3;

export type Stock = (typeof STOCK_LEVELS)[number];
export type Source = (typeof SOURCES)[number];
export type Field = (typeof CORRECTABLE)[number];
// A field's value as the database holds it: text, cents, or a date / null.
export type Value = string | number | null;

export interface Author {
  id: string;
  name: string;
}

export interface PendingCorrection {
  field: Field;
  value: Value;
  votes: number;
  voters: Author[];
  notes: string[];
}

export interface AppliedCorrection {
  field: Field;
  from: Value;
  to: Value;
  by: "poster" | "crowd";
  at: string;
}

export interface StockReport {
  stock: Stock;
  by: Author;
  at: string;
}

export interface Deal {
  id: number;
  storeId: string;
  item: string;
  wasCents: number;
  nowCents: number;
  endsOn: string | null;
  source: Source;
  author: Author;
  createdAt: string;
  stock: Stock;
  stockBy: Author;
  stockAt: string;
  stockHistory: StockReport[];
  comments: number;
  confirmations: number;
  confirmedBy: Author[];
  pending: PendingCorrection[];
  history: AppliedCorrection[];
}

export interface Comment {
  id: number;
  dealId: number;
  body: string;
  author: Author;
  createdAt: string;
}

export interface Notification {
  id: number;
  dealId: number;
  text: string;
  createdAt: string;
}

const dataDir = process.env.DATA_DIR ?? "data";
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "specials.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS deals (
    id          INTEGER PRIMARY KEY,
    store_id    TEXT NOT NULL,
    item        TEXT NOT NULL,
    was_cents   INTEGER NOT NULL,
    now_cents   INTEGER NOT NULL,
    ends_on     TEXT,
    source      TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  -- every stock report is kept; a deal's current level is its latest one
  CREATE TABLE IF NOT EXISTS stock_reports (
    id          INTEGER PRIMARY KEY,
    deal_id     INTEGER NOT NULL REFERENCES deals(id),
    stock       TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY,
    deal_id     INTEGER NOT NULL REFERENCES deals(id),
    body        TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  -- "I saw this too, and it's right": once per person per deal
  CREATE TABLE IF NOT EXISTS confirmations (
    deal_id     INTEGER NOT NULL REFERENCES deals(id),
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (deal_id, author_id)
  );

  -- A proposal to change one field. While resolved_at is null it's a vote;
  -- once applied, applied_at and previous record the change. A person has at
  -- most one open proposal per field (a new one replaces it).
  CREATE TABLE IF NOT EXISTS corrections (
    id          INTEGER PRIMARY KEY,
    deal_id     INTEGER NOT NULL REFERENCES deals(id),
    field       TEXT NOT NULL,
    value       TEXT,
    note        TEXT,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    resolved_at TEXT,
    applied_at  TEXT,
    previous    TEXT,
    applied_by  TEXT
  );

  -- messages for a poster about their deals, shown next time they open the app
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY,
    author_id  TEXT NOT NULL,
    deal_id    INTEGER NOT NULL REFERENCES deals(id),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    seen_at    TEXT
  );

  -- accounts: users.id is the public id that appears on posts; a session's
  -- token itself is never stored, only its hash
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_salt    TEXT NOT NULL,
    pw_hash    TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS deals_store ON deals(store_id, created_at);
  CREATE INDEX IF NOT EXISTS stock_deal ON stock_reports(deal_id, id);
  CREATE INDEX IF NOT EXISTS comments_deal ON comments(deal_id, id);
  CREATE INDEX IF NOT EXISTS corrections_deal ON corrections(deal_id, resolved_at);
  CREATE INDEX IF NOT EXISTS notifications_author ON notifications(author_id, seen_at);
`);

// --- migrations for databases created by an earlier version

const columns = (table: string): string[] =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => (c as { name: string }).name);

if (!columns("deals").includes("item_key")) {
  db.exec(`ALTER TABLE deals ADD COLUMN item_key TEXT`);
  const set = db.prepare(`UPDATE deals SET item_key = ? WHERE id = ?`);
  for (const r of db.prepare(`SELECT id, item FROM deals`).all() as { id: number; item: string }[]) {
    set.run(itemKey(r.item), r.id);
  }
}
db.exec(`DROP INDEX IF EXISTS deals_dupe`);
db.exec(`CREATE INDEX IF NOT EXISTS deals_live ON deals(store_id, item_key)`);

// A deleted deal is hidden, not removed: other people's comments,
// confirmations and corrections on it stay in the database.
if (!columns("deals").includes("deleted_at")) {
  db.exec(`ALTER TABLE deals ADD COLUMN deleted_at TEXT`);
}

// ---

const now = (): string => new Date().toISOString();

function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const COLUMN: Record<Field, string> = {
  item: "item",
  wasCents: "was_cents",
  nowCents: "now_cents",
  endsOn: "ends_on",
};

// Corrections store their value as text; prices come back as numbers.
const encode = (v: Value): string | null => (v === null ? null : String(v));
const decode = (field: Field, v: unknown): Value =>
  v === null || v === undefined ? null : field === "wasCents" || field === "nowCents" ? Number(v) : String(v);

// Two proposals for the item name agree if they key the same, so "Tim Tams
// 200 g" and "tim tams 200g" are one vote, not two.
const voteKey = (field: Field, v: Value): string => (field === "item" && typeof v === "string" ? itemKey(v) : String(v));

const selectDeals = `
  SELECT d.*,
         s.stock, s.author_id AS stock_author_id, s.author_name AS stock_author_name,
         s.created_at AS stock_at,
         (SELECT count(*) FROM comments c WHERE c.deal_id = d.id) AS comments
  FROM deals d
  JOIN stock_reports s ON s.id = (SELECT max(id) FROM stock_reports WHERE deal_id = d.id)
`;

type Row = Record<string, unknown>;

function pendingFor(dealId: number): PendingCorrection[] {
  const rows = db
    .prepare(`SELECT * FROM corrections WHERE deal_id = ? AND resolved_at IS NULL ORDER BY id`)
    .all(dealId) as Row[];
  const groups = new Map<string, PendingCorrection>();
  for (const r of rows) {
    const field = r.field as Field;
    const value = decode(field, r.value);
    const key = `${field}\u0000${voteKey(field, value)}`;
    const g = groups.get(key) ?? { field, value, votes: 0, voters: [], notes: [] };
    g.votes += 1;
    g.voters.push({ id: r.author_id as string, name: r.author_name as string });
    if (r.note) g.notes.push(r.note as string);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.votes - a.votes);
}

function historyFor(dealId: number): AppliedCorrection[] {
  const rows = db
    .prepare(`SELECT * FROM corrections WHERE deal_id = ? AND applied_at IS NOT NULL ORDER BY applied_at, id`)
    .all(dealId) as Row[];
  return rows.map((r) => {
    const field = r.field as Field;
    return {
      field,
      from: decode(field, r.previous),
      to: decode(field, r.value),
      by: r.applied_by as "poster" | "crowd",
      at: r.applied_at as string,
    };
  });
}

// The latest few reports, newest first, so a sudden flip-flop is visible.
const STOCK_HISTORY = 5;
function recentStock(dealId: number): StockReport[] {
  const rows = db
    .prepare(`SELECT stock, author_id, author_name, created_at FROM stock_reports WHERE deal_id = ? ORDER BY id DESC LIMIT ?`)
    .all(dealId, STOCK_HISTORY) as Row[];
  return rows.map((r) => ({
    stock: r.stock as Stock,
    by: { id: r.author_id as string, name: r.author_name as string },
    at: r.created_at as string,
  }));
}

function toDeal(r: Row): Deal {
  const id = r.id as number;
  const confirmedBy = (
    db.prepare(`SELECT author_id, author_name FROM confirmations WHERE deal_id = ? ORDER BY created_at`).all(id) as Row[]
  ).map((c) => ({ id: c.author_id as string, name: c.author_name as string }));
  return {
    id,
    storeId: r.store_id as string,
    item: r.item as string,
    wasCents: r.was_cents as number,
    nowCents: r.now_cents as number,
    endsOn: (r.ends_on as string | null) ?? null,
    source: r.source as Source,
    author: { id: r.author_id as string, name: r.author_name as string },
    createdAt: r.created_at as string,
    stock: r.stock as Stock,
    stockBy: { id: r.stock_author_id as string, name: r.stock_author_name as string },
    stockAt: r.stock_at as string,
    stockHistory: recentStock(id),
    comments: Number(r.comments),
    confirmations: confirmedBy.length,
    confirmedBy,
    pending: pendingFor(id),
    history: historyFor(id),
  };
}

// running (not ended) and not deleted; takes today's date as its parameter
const active = `(d.ends_on IS NULL OR d.ends_on >= ?) AND d.deleted_at IS NULL`;

// Deals that ended before `sinceEndsOn` (a YYYY-MM-DD date) drop out of the
// feed; they stay in the database.
export function listDeals(storeId: string | null, sinceEndsOn: string): Deal[] {
  const where = `WHERE ${active}` + (storeId ? ` AND d.store_id = ?` : "");
  const args = storeId ? [sinceEndsOn, storeId] : [sinceEndsOn];
  const rows = db.prepare(`${selectDeals} ${where} ORDER BY d.created_at DESC LIMIT 200`).all(...args);
  return rows.map((r) => toDeal(r as Row));
}

// A deleted deal reads as missing, so nothing can be done to it either.
export function getDeal(id: number): Deal | null {
  const row = db.prepare(`${selectDeals} WHERE d.id = ? AND d.deleted_at IS NULL`).get(id);
  return row ? toDeal(row as Row) : null;
}

// Active deals at one store whose item looks like `item`, closest first.
export function similarDeals(storeId: string, item: string, today: string): (Deal & { score: number })[] {
  const rows = db.prepare(`SELECT d.id, d.item FROM deals d WHERE d.store_id = ? AND ${active}`).all(storeId, today) as {
    id: number;
    item: string;
  }[];
  return rows
    .map((r) => ({ id: r.id, score: similarity(item, r.item) }))
    .filter((r) => r.score >= SIMILAR_ENOUGH)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => ({ ...getDeal(r.id)!, score: Math.round(r.score * 100) / 100 }));
}

// The one-post-per-person rule: this person's active deal for the same item
// at the same store, if there is one.
// The live post for this item at this store, whoever posted it (other than
// `exceptId`). One item, one store, one live post: README point 1.
export function liveDuplicate(storeId: string, item: string, today: string, exceptId = 0): Deal | null {
  const row = db
    .prepare(`SELECT d.id FROM deals d WHERE d.store_id = ? AND d.item_key = ? AND d.id != ? AND ${active}`)
    .get(storeId, itemKey(item), exceptId, today) as { id: number } | undefined;
  return row ? getDeal(row.id) : null;
}

export interface NewDeal {
  storeId: string;
  item: string;
  wasCents: number;
  nowCents: number;
  endsOn: string | null;
  stock: Stock;
  source: Source;
  author: Author;
}

// Checks for a live duplicate and inserts in one transaction, so two people
// posting the same thing at the same moment can't both get in.
export function createDeal(d: NewDeal, today: string): { created: Deal } | { existing: Deal } {
  const at = now();
  const id = tx(() => {
    const existing = liveDuplicate(d.storeId, d.item, today);
    if (existing) return existing;
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO deals (store_id, item, item_key, was_cents, now_cents, ends_on, source, author_id, author_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.storeId, d.item, itemKey(d.item), d.wasCents, d.nowCents, d.endsOn, d.source, d.author.id, d.author.name, at);
    db.prepare(
      `INSERT INTO stock_reports (deal_id, stock, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(lastInsertRowid, d.stock, d.author.id, d.author.name, at);
    return Number(lastInsertRowid);
  });
  return typeof id === "number" ? { created: getDeal(id)! } : { existing: id };
}

export function deleteDeal(id: number): void {
  db.prepare(`UPDATE deals SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(now(), id);
}

// One person may report a deal's stock once per STOCK_COOLDOWN_MS, so nobody
// can flip it back and forth. Returns the seconds still to wait, or 0.
export const STOCK_COOLDOWN_MS = 60_000;
export function stockWait(dealId: number, author: Author): number {
  const last = db
    .prepare(`SELECT created_at FROM stock_reports WHERE deal_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1`)
    .get(dealId, author.id) as Row | undefined;
  if (!last) return 0;
  const left = Date.parse(last.created_at as string) + STOCK_COOLDOWN_MS - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// --- accounts and sessions

export interface Account extends User {
  salt: string;
  hash: string;
}

const toAccount = (r: Row): Account => ({
  id: r.id as string,
  name: r.username as string,
  role: r.role as User["role"],
  salt: r.pw_salt as string,
  hash: r.pw_hash as string,
});

// Returns null if the username is taken (usernames compare without case).
export function createUser(username: string, salt: string, hash: string, role: User["role"]): User | null {
  const id = newUserId();
  const { changes } = db
    .prepare(
      `INSERT INTO users (id, username, pw_salt, pw_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (username) DO NOTHING`,
    )
    .run(id, username, salt, hash, role, now());
  return Number(changes) > 0 ? { id, name: username, role } : null;
}

export function accountByName(username: string): Account | null {
  const r = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as Row | undefined;
  return r ? toAccount(r) : null;
}

// Admins come from the ADMIN_USERS environment variable, not from the API.
export function setAdmins(usernames: string[]): void {
  const promote = db.prepare(`UPDATE users SET role = 'admin' WHERE username = ?`);
  for (const u of usernames) promote.run(u);
}

export function startSession(user: User, token: string, days: number): void {
  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now());
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`).run(tokenHash(token), user.id, expires);
}

export function userForToken(token: string): User | null {
  const r = db
    .prepare(
      `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash(token), now()) as Row | undefined;
  return r ? { id: r.id as string, name: r.username as string, role: r.role as User["role"] } : null;
}

export function endSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash(token));
}

export function reportStock(dealId: number, stock: Stock, author: Author): void {
  db.prepare(
    `INSERT INTO stock_reports (deal_id, stock, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(dealId, stock, author.id, author.name, now());
}

// Returns false if this person had already confirmed it.
export function confirmDeal(dealId: number, author: Author): boolean {
  const { changes } = db
    .prepare(
      `INSERT INTO confirmations (deal_id, author_id, author_name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (deal_id, author_id) DO NOTHING`,
    )
    .run(dealId, author.id, author.name, now());
  return Number(changes) > 0;
}

export function fieldValue(deal: Deal, field: Field): Value {
  return deal[field];
}

const FIELD_TEXT: Record<Field, string> = {
  item: "item name",
  wasCents: "usual price",
  nowCents: "special price",
  endsOn: "end date",
};

const show = (field: Field, v: Value): string =>
  v === null ? "no end date" : field === "wasCents" || field === "nowCents" ? `$${(Number(v) / 100).toFixed(2)}` : String(v);

export interface CorrectionResult {
  applied: boolean;
  votes: number;
  needed: number;
}

// Records `author`'s proposal and applies it if it now carries: at once for
// the poster, or when CORRECTION_QUORUM other people agree on the same value.
// `fits` re-checks the deal as it would be after the change (e.g. the special
// still cheaper than usual); a change that wouldn't fit stays a proposal.
export function proposeCorrection(
  dealId: number,
  field: Field,
  value: Value,
  note: string | null,
  author: Author,
  fits: (after: Deal) => boolean,
): CorrectionResult {
  return tx(() => {
    const at = now();
    const deal = getDeal(dealId)!;
    const byPoster = author.id === deal.author.id;

    db.prepare(`DELETE FROM corrections WHERE deal_id = ? AND field = ? AND author_id = ? AND resolved_at IS NULL`).run(
      dealId,
      field,
      author.id,
    );
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO corrections (deal_id, field, value, note, author_id, author_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(dealId, field, encode(value), note, author.id, author.name, at);

    const agree = pendingFor(dealId).find((p) => p.field === field && voteKey(field, p.value) === voteKey(field, value))!;
    const votes = agree.voters.filter((v) => v.id !== deal.author.id).length;
    const carries = byPoster || votes >= CORRECTION_QUORUM;
    if (!carries || !fits({ ...deal, [field]: value })) {
      return { applied: false, votes, needed: CORRECTION_QUORUM };
    }

    const previous = fieldValue(deal, field);
    const extra = field === "item" ? `, item_key = ?` : "";
    const args: (string | number | null)[] = field === "item" ? [value, itemKey(String(value))] : [value];
    db.prepare(`UPDATE deals SET ${COLUMN[field]} = ?${extra} WHERE id = ?`).run(...args, dealId);
    // this proposal is the applied one; every other open one for the field is settled by it
    db.prepare(
      `UPDATE corrections SET applied_at = ?, previous = ?, applied_by = ?, resolved_at = ? WHERE id = ?`,
    ).run(at, encode(previous), byPoster ? "poster" : "crowd", at, lastInsertRowid);
    db.prepare(`UPDATE corrections SET resolved_at = ? WHERE deal_id = ? AND field = ? AND resolved_at IS NULL`).run(
      at,
      dealId,
      field,
    );

    if (!byPoster) {
      db.prepare(`INSERT INTO notifications (author_id, deal_id, text, created_at) VALUES (?, ?, ?, ?)`).run(
        deal.author.id,
        dealId,
        `${votes} people corrected the ${FIELD_TEXT[field]} on your post "${deal.item}": ` +
          `${show(field, previous)} → ${show(field, value)}.`,
        at,
      );
    }
    return { applied: true, votes, needed: CORRECTION_QUORUM };
  });
}

// Unseen notifications for this person, marked seen as they're handed over.
export function takeNotifications(authorId: string): Notification[] {
  return tx(() => {
    const rows = db
      .prepare(`SELECT * FROM notifications WHERE author_id = ? AND seen_at IS NULL ORDER BY id`)
      .all(authorId) as Row[];
    db.prepare(`UPDATE notifications SET seen_at = ? WHERE author_id = ? AND seen_at IS NULL`).run(now(), authorId);
    return rows.map((r) => ({
      id: r.id as number,
      dealId: r.deal_id as number,
      text: r.text as string,
      createdAt: r.created_at as string,
    }));
  });
}

export function listComments(dealId: number): Comment[] {
  return db
    .prepare(`SELECT * FROM comments WHERE deal_id = ? ORDER BY id`)
    .all(dealId)
    .map((r) => {
      const row = r as Row;
      return {
        id: row.id as number,
        dealId: row.deal_id as number,
        body: row.body as string,
        author: { id: row.author_id as string, name: row.author_name as string },
        createdAt: row.created_at as string,
      };
    });
}

export function addComment(dealId: number, body: string, author: Author): Comment {
  const at = now();
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO comments (deal_id, body, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(dealId, body, author.id, author.name, at);
  return { id: Number(lastInsertRowid), dealId, body, author, createdAt: at };
}
