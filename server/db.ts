import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Everything that persists lives in one SQLite file on the Fly volume (/data
// in the image; ./data when run locally). Prices are integer cents.

export const STOCK_LEVELS = ["plenty", "some", "few", "gone"] as const;
export const SOURCES = ["in-store", "store-website", "catalogue", "word-of-mouth"] as const;
export type Stock = (typeof STOCK_LEVELS)[number];
export type Source = (typeof SOURCES)[number];

export interface Author {
  id: string;
  name: string;
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
  comments: number;
}

export interface Comment {
  id: number;
  dealId: number;
  body: string;
  author: Author;
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

  CREATE INDEX IF NOT EXISTS deals_store ON deals(store_id, created_at);
  CREATE INDEX IF NOT EXISTS stock_deal ON stock_reports(deal_id, id);
  CREATE INDEX IF NOT EXISTS comments_deal ON comments(deal_id, id);
`);

const now = (): string => new Date().toISOString();

const selectDeals = `
  SELECT d.*,
         s.stock, s.author_id AS stock_author_id, s.author_name AS stock_author_name,
         s.created_at AS stock_at,
         (SELECT count(*) FROM comments c WHERE c.deal_id = d.id) AS comments
  FROM deals d
  JOIN stock_reports s ON s.id = (SELECT max(id) FROM stock_reports WHERE deal_id = d.id)
`;

type Row = Record<string, unknown>;

function toDeal(r: Row): Deal {
  return {
    id: r.id as number,
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
    comments: Number(r.comments),
  };
}

// Deals that ended before `sinceEndsOn` (a YYYY-MM-DD date) drop out of the
// feed; they stay in the database.
export function listDeals(storeId: string | null, sinceEndsOn: string): Deal[] {
  const where = `WHERE (d.ends_on IS NULL OR d.ends_on >= ?)` + (storeId ? ` AND d.store_id = ?` : "");
  const args = storeId ? [sinceEndsOn, storeId] : [sinceEndsOn];
  const rows = db.prepare(`${selectDeals} ${where} ORDER BY d.created_at DESC LIMIT 200`).all(...args);
  return rows.map((r) => toDeal(r as Row));
}

export function getDeal(id: number): Deal | null {
  const row = db.prepare(`${selectDeals} WHERE d.id = ?`).get(id);
  return row ? toDeal(row as Row) : null;
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

export function createDeal(d: NewDeal): Deal {
  const at = now();
  db.exec("BEGIN");
  try {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO deals (store_id, item, was_cents, now_cents, ends_on, source, author_id, author_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.storeId, d.item, d.wasCents, d.nowCents, d.endsOn, d.source, d.author.id, d.author.name, at);
    db.prepare(
      `INSERT INTO stock_reports (deal_id, stock, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(lastInsertRowid, d.stock, d.author.id, d.author.name, at);
    db.exec("COMMIT");
    return getDeal(Number(lastInsertRowid))!;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function reportStock(dealId: number, stock: Stock, author: Author): void {
  db.prepare(
    `INSERT INTO stock_reports (deal_id, stock, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(dealId, stock, author.id, author.name, now());
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
