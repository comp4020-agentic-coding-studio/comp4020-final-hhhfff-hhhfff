import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { marked } from "marked";
import { broadcast, listen, tell } from "./events.ts";
import { type Action, can, hashPassword, newToken, SESSION_DAYS, type User, verifyPassword } from "./auth.ts";
import {
  accountByName,
  activeDealKeys,
  addComment,
  confirmDeal,
  CORRECTABLE,
  createDeal,
  createUser,
  dealKey,
  deleteDeal,
  endSession,
  feedVersion,
  fieldValue,
  getDeal,
  listComments,
  liveDuplicate,
  proposeCorrection,
  reportStock,
  setAdmins,
  similarDeals,
  SOURCES,
  startSession,
  STOCK_LEVELS,
  stockWait,
  takeNotifications,
  userForToken,
  type Author,
  type Deal,
  type DealKey,
  type Field,
  type Source,
  type Stock,
  type Value,
} from "./db.ts";
import { itemKey, searchScore, searchTerms } from "./match.ts";
import { type Store, STORES, storeById } from "./stores.ts";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY = 8 * 1024;

class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// --- dates: "today" is always Canberra's today, whatever the server's clock zone

const canberraDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Canberra" });
const todayInCanberra = (): string => canberraDate.format(new Date());

// --- input checks. Everything from a client is untrusted; these are the only
// way a value reaches the database.

function str(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== "string") throw new HttpError(400, `${field} is required`);
  const s = v.trim().replace(/\s+/g, " ");
  if (s.length < min || s.length > max) throw new HttpError(400, `${field} must be ${min}–${max} characters`);
  return s;
}

function cents(v: unknown, field: string): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100_000) {
    throw new HttpError(400, `${field} must be a price between $0 and $1000`);
  }
  return v as number;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

// --- the feed and search. Every active deal's sort key (and, for a search,
// its item and store) is read and ordered, cheaply; only one page is loaded in
// full. Order: sold-out posts after the rest, then closer matches (for a
// search), then newest, then id. The page asks for numbered pages of ten
// (`page`, `per`) and numbers them by the x-total-count header; reading the
// whole feed carries on after the last deal read (`after`), so posts arriving
// or leaving meanwhile neither repeat nor skip one.

const FEED_PAGE = 100; // the most one request returns, and the default
const SEARCH_MAX = 80;
const KIND_WORDS: Record<Store["kind"], string> = {
  supermarket: "supermarket",
  asian: "asian grocery grocer",
  convenience: "convenience store",
};
// each store's name, suburb and kind, normalised once for search
const STORE_KEYS = new Map(STORES.map((s) => [s.id, itemKey(`${s.name} ${s.where} ${KIND_WORDS[s.kind]}`)]));

type Ranked = DealKey & { score: number; typo: boolean };
const rank = (d: DealKey, terms: string[] | null): Ranked =>
  terms ? { ...d, ...searchScore(terms, d.itemKey, STORE_KEYS.get(d.storeId) ?? "") } : { ...d, score: 0, typo: false };
// negative when a comes first in the feed
const feedOrder = (a: Ranked, b: Ranked) =>
  Number(a.gone) - Number(b.gone) || b.score - a.score || b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

// the deal a page carries on after; absent means the first page
function afterId(v: string | null): number | null {
  if (v === null) return null;
  if (!/^[1-9]\d{0,9}$/.test(v)) throw new HttpError(400, "after must be a deal id");
  return Number(v);
}

// A whole number from the address within [min, max], or `fallback` if absent.
function wholeParam(v: string | null, field: string, min: number, max: number, fallback: number): number {
  if (v === null) return fallback;
  if (!/^\d{1,6}$/.test(v) || Number(v) < min || Number(v) > max) {
    throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}`);
  }
  return Number(v);
}

// Which slice of the feed: numbered pages of `per` (what the page shows, with
// the total to number them by), or the `per` deals after a given one (stable
// for reading the whole feed while others post). Not both.
interface Slice {
  after: number | null;
  page: number;
  per: number;
}

// The sorted (and, for a search, scored) list for one store and search, kept
// until the feed changes or the day turns, so everyone reading page one shares
// one sort instead of each doing it again. At most LIST_CACHE_MAX lists are
// kept, the oldest dropped first; nobody's typing can grow it further.
const LIST_CACHE_MAX = 50;
const listCache = new Map<string, Ranked[]>();
let listCacheFor = "";

function rankedList(store: string | null, terms: string[] | null): Ranked[] {
  const today = todayInCanberra();
  const stamp = `${feedVersion()}|${today}`;
  if (stamp !== listCacheFor) {
    listCache.clear();
    listCacheFor = stamp;
  }
  const key = `${store ?? ""}|${terms?.join(" ") ?? ""}`;
  const kept = listCache.get(key);
  if (kept) return kept;

  let found = activeDealKeys(store, today).map((d) => rank(d, terms));
  if (terms) {
    found = found.filter((d) => d.score > 0);
    // a near-miss spelling is a fallback: shown only when nothing matches as typed
    const exact = found.filter((d) => !d.typo);
    if (exact.length) found = exact;
  }
  found.sort(feedOrder);
  if (listCache.size >= LIST_CACHE_MAX) listCache.delete(listCache.keys().next().value!);
  listCache.set(key, found);
  return found;
}

// Each store with how many of its specials are live and not sold out, for
// the page's map. Worked out from the same cached keys as the feed.
function storesWithCounts(): (Store & { live: number })[] {
  const live = new Map<string, number>();
  for (const k of activeDealKeys(null, todayInCanberra())) if (!k.gone) live.set(k.storeId, (live.get(k.storeId) ?? 0) + 1);
  return STORES.map((st) => ({ ...st, live: live.get(st.id) ?? 0 }));
}

function feedPage(store: string | null, query: string | null, slice: Slice): { deals: Deal[]; total: number } {
  const terms = query === null ? null : searchTerms(query);
  if (terms && !terms.length) return { deals: [], total: 0 };
  let found = rankedList(store, terms); // shared: filter and slice it, never change it
  const total = found.length;
  const { after, page, per } = slice;
  if (after !== null) {
    const last = dealKey(after);
    if (!last) throw new HttpError(400, "after must be a deal id");
    const mark = rank(last, terms);
    found = found.filter((d) => feedOrder(mark, d) < 0);
  } else found = found.slice((page - 1) * per);
  return { deals: found.slice(0, per).map((d) => getDeal(d.id)!), total };
}

// --- accounts. Who you are comes only from the session cookie, never from the
// request body, and what you may do from your role (server/auth.ts). A public
// id, which every response shows, can't stand in for a session.

const USERNAME = /^[A-Za-z0-9_-]{3,24}$/;
const COOKIE = "sid";

// Admins are named in ADMIN_USERS (comma separated). At startup exactly those
// accounts become admins and any other admin goes back to being a user.
const ADMINS = new Set((process.env.ADMIN_USERS ?? "").split(",").map((u) => u.trim()).filter(Boolean));
setAdmins([...ADMINS]);

function tokenOf(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=") || null;
  }
  return null;
}

const whoIs = (req: IncomingMessage): User | null => {
  const token = tokenOf(req);
  return token ? userForToken(token) : null;
};

// A guest gets 401 (log in), a signed-in user without the role gets 403.
function need(req: IncomingMessage, action: Action, what: string): User {
  const user = whoIs(req);
  if (!user) throw new HttpError(401, `log in to ${what}`);
  if (!can(user.role, action)) throw new HttpError(403, `your account can't ${what}`);
  return user;
}

const asAuthor = (u: User): Author => ({ id: u.id, name: u.name });

function password(v: unknown): string {
  if (typeof v !== "string" || v.length < 8 || v.length > 128) {
    throw new HttpError(400, "password must be 8–128 characters");
  }
  return v;
}

function setCookie(req: IncomingMessage, token: string, maxAge: number): string {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

// Too many wrong passwords for one username in a minute pauses logins for it.
const failures = new Map<string, { count: number; since: number }>();
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 60_000;
function loginBlocked(username: string): boolean {
  const f = failures.get(username.toLowerCase());
  return !!f && Date.now() - f.since < FAILURE_WINDOW_MS && f.count >= MAX_FAILURES;
}
function noteFailure(username: string): void {
  if (failures.size > 5000) failures.clear();
  const key = username.toLowerCase();
  const f = failures.get(key);
  failures.set(key, f && Date.now() - f.since < FAILURE_WINDOW_MS ? { ...f, count: f.count + 1 } : { count: 1, since: Date.now() });
}

// a password check that costs the same whether or not the username exists
const NO_SUCH_USER = await hashPassword("no such user");

// A correction's new value, checked the same way as when the deal was posted.
function fieldInput(field: Field, v: unknown): Value {
  switch (field) {
    case "item":
      return str(v, "item", 2, 80);
    case "wasCents":
      return cents(v, "usual price");
    case "nowCents":
      return cents(v, "special price");
    case "endsOn":
      return endsOn(v);
  }
}

const sameValue = (field: Field, a: Value, b: Value): boolean =>
  field === "item" ? itemKey(String(a)) === itemKey(String(b)) : a === b;

function endsOn(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, "end date must be YYYY-MM-DD");
  }
  if (v < todayInCanberra()) throw new HttpError(400, "end date is already in the past");
  return v;
}

function dealId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || !getDeal(id)) throw new HttpError(404, "no such deal");
  return id;
}

// --- plumbing

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // fall through
  }
  throw new HttpError(400, "body must be a JSON object");
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

// Text files go out gzipped to a browser that accepts it: the page's script
// and the map's street data shrink to about a quarter. Each file's gzip is
// kept until the file changes, so it is worked out once, not per request.
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".svg", ".json"]);
const gzipped = new Map<string, { raw: Buffer; gz: Buffer }>();

function gzipOf(path: string, data: Buffer): Buffer {
  const kept = gzipped.get(path);
  if (kept?.raw.equals(data)) return kept.gz;
  const gz = gzipSync(data);
  gzipped.set(path, { raw: data, gz });
  return gz;
}

async function sendFile(req: IncomingMessage, res: ServerResponse, root: string, rel: string): Promise<void> {
  const path = normalize(join(root, rel));
  if (!path.startsWith(normalize(root))) throw new HttpError(404, "not found");
  let data: Buffer;
  try {
    data = await readFile(path);
  } catch {
    throw new HttpError(404, "not found");
  }
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  if (!COMPRESSIBLE.has(extname(path))) {
    res.writeHead(200, { "content-type": type });
    return void res.end(data);
  }
  const accepts = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  res.writeHead(200, { "content-type": type, vary: "accept-encoding", ...(accepts ? { "content-encoding": "gzip" } : {}) });
  res.end(accepts ? gzipOf(path, data) : data);
}

// README.md is read per request, so a local edit shows without a restart.
// Relative image links (docs/x.png) resolve under /readme/, which serves docs/.
async function sendReadme(res: ServerResponse): Promise<void> {
  const md = await readFile("README.md", "utf8");
  const body = await marked.parse(md);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About · discountShow</title>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/styles.css">
</head>
<body class="readme">
<header class="masthead">
<div class="wrap">
<p class="title"><a href="/">discountShow</a></p>
<p class="tagline"><a href="/">← Back to the specials</a></p>
</div>
</header>
<main>${body}</main>
</body>
</html>`);
}

// --- routes

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";
  let m: RegExpMatchArray | null;

  if (method === "GET" && path === "/api/stores") return send(res, 200, storesWithCounts());

  // live updates: who is listening only decides who also gets their own notices
  if (method === "GET" && path === "/api/events") {
    if (!listen(req, res, whoIs(req)?.id ?? null)) throw new HttpError(503, "too many people are watching live, try again soon");
    return;
  }

  // --- accounts
  if (method === "GET" && path === "/api/me") return send(res, 200, whoIs(req));

  if (method === "POST" && (path === "/api/register" || path === "/api/login")) {
    const b = await readJson(req);
    const username = typeof b.username === "string" ? b.username.trim() : "";
    if (!USERNAME.test(username)) throw new HttpError(400, "username must be 3–24 letters, digits, - or _");
    const pw = password(b.password);
    let user: User | null;
    if (path === "/api/register") {
      const { salt, hash } = await hashPassword(pw);
      // a name on ADMIN_USERS that registers after startup is an admin from the start
      user = createUser(username, salt, hash, ADMINS.has(username) ? "admin" : "user");
      if (!user) throw new HttpError(409, "that username is taken");
    } else {
      if (loginBlocked(username)) throw new HttpError(429, "too many wrong passwords, wait a minute");
      const account = accountByName(username);
      const ok = await verifyPassword(pw, (account ?? NO_SUCH_USER).salt, (account ?? NO_SUCH_USER).hash);
      if (!account || !ok) {
        noteFailure(username);
        throw new HttpError(401, "wrong username or password");
      }
      failures.delete(username.toLowerCase());
      user = account;
    }
    const token = newToken();
    const me: User = { id: user!.id, name: user!.name, role: user!.role };
    startSession(me, token, SESSION_DAYS);
    return send(res, path === "/api/register" ? 201 : 200, me, {
      "set-cookie": setCookie(req, token, SESSION_DAYS * 86_400),
    });
  }

  if (method === "POST" && path === "/api/logout") {
    const token = tokenOf(req);
    if (token) endSession(token);
    return send(res, 200, { ok: true }, { "set-cookie": setCookie(req, "", 0) });
  }

  if (method === "GET" && path === "/api/deals") {
    const store = url.searchParams.get("store");
    if (store && !storeById.has(store)) throw new HttpError(404, "no such store");
    const p = url.searchParams;
    const after = afterId(p.get("after"));
    if (after !== null && p.has("page")) throw new HttpError(400, "ask for a page or for the deals after one, not both");
    const slice = { after, page: wholeParam(p.get("page"), "page", 1, 100_000, 1), per: wholeParam(p.get("per"), "per", 1, FEED_PAGE, FEED_PAGE) };
    const q = p.get("q")?.trim();
    const { deals, total } = feedPage(store, q ? str(q, "search", 1, SEARCH_MAX) : null, slice);
    return send(res, 200, deals, { "x-total-count": String(total) });
  }

  if (method === "POST" && path === "/api/deals") {
    const who = asAuthor(need(req, "post", "post a special"));
    const b = await readJson(req);
    const storeId = typeof b.storeId === "string" && storeById.has(b.storeId) ? b.storeId : null;
    if (!storeId) throw new HttpError(400, "pick a store");
    const wasCents = cents(b.wasCents, "usual price");
    const nowCents = cents(b.nowCents, "special price");
    if (nowCents >= wasCents) throw new HttpError(400, "the special price has to be lower than the usual price");
    const item = str(b.item, "item", 2, 80);
    // one live post per item per store, whoever posted it: a different price
    // for the same thing is a correction, and "me too" is a confirmation
    const result = createDeal(
      {
        storeId,
        item,
        wasCents,
        nowCents,
        endsOn: endsOn(b.endsOn),
        stock: oneOf<Stock>(b.stock, STOCK_LEVELS, "stock"),
        source: oneOf<Source>(b.source, SOURCES, "source"),
        author: who,
      },
      todayInCanberra(),
    );
    if ("existing" in result) {
      const { existing } = result;
      throw new HttpError(
        409,
        existing.author.id === who.id
          ? "you've already posted this item at this store; correct that post instead"
          : "someone has already posted this item at this store; confirm or correct their post instead",
        { existing },
      );
    }
    broadcast({ type: "new", id: result.created.id });
    return send(res, 201, result.created);
  }

  // possible duplicates, shown before posting so people join a deal instead of repeating it
  if (method === "GET" && path === "/api/deals/similar") {
    const store = url.searchParams.get("store") ?? "";
    if (!storeById.has(store)) throw new HttpError(404, "no such store");
    const item = str(url.searchParams.get("item"), "item", 2, 80);
    return send(res, 200, similarDeals(store, item, todayInCanberra()));
  }

  // only the poster (or an admin) can take a post down, whoever else has added to it
  if ((m = path.match(/^\/api\/deals\/(\d+)\/delete$/)) && method === "POST") {
    const user = need(req, "delete-own", "delete a post");
    const id = dealId(m[1]);
    if (getDeal(id)!.author.id !== user.id && !can(user.role, "delete-any")) {
      throw new HttpError(403, "only the person who posted this can delete it");
    }
    deleteDeal(id);
    broadcast({ type: "deleted", id });
    return send(res, 200, { deleted: id });
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)\/confirm$/)) && method === "POST") {
    const who = asAuthor(need(req, "confirm", "confirm a post"));
    const id = dealId(m[1]);
    if (getDeal(id)!.author.id === who.id) throw new HttpError(400, "that's your own post");
    const added = confirmDeal(id, who);
    if (added) broadcast({ type: "deal", id });
    return send(res, added ? 201 : 200, getDeal(id));
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)\/corrections$/)) && method === "POST") {
    const who = asAuthor(need(req, "correct", "correct a post"));
    const id = dealId(m[1]);
    const b = await readJson(req);
    const field = oneOf<Field>(b.field, CORRECTABLE, "field");
    const value = fieldInput(field, b.value);
    const note = b.note === undefined || b.note === null || b.note === "" ? null : str(b.note, "note", 1, 280);
    const deal = getDeal(id)!;
    if (sameValue(field, fieldValue(deal, field), value)) throw new HttpError(400, "that's what the post already says");
    const after = { ...deal, [field]: value };
    if (after.nowCents >= after.wasCents) {
      throw new HttpError(400, "the special price has to stay lower than the usual price");
    }
    // renaming (or reviving) a post must not make it a second live post for an item
    const today = todayInCanberra();
    const clash = (d: Deal): Deal | null =>
      d.endsOn !== null && d.endsOn < today ? null : liveDuplicate(d.storeId, d.item, today, d.id);
    const existing = clash(after);
    if (existing) {
      throw new HttpError(409, "another live post at this store already has that item; confirm or correct it instead", {
        existing,
      });
    }
    // checked again as it applies, inside the same transaction as the write
    const result = proposeCorrection(id, field, value, note, who, (d) => d.nowCents < d.wasCents && !clash(d));
    broadcast({ type: "deal", id });
    if (deal.author.id !== who.id) tell(deal.author.id, { type: "notice" });
    return send(res, result.applied ? 200 : 201, { ...result, deal: getDeal(id) });
  }

  // a poster's unseen notifications, handed over once
  if (method === "POST" && path === "/api/notifications") {
    return send(res, 200, takeNotifications(need(req, "notifications", "see notifications").id));
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)$/)) && method === "GET") {
    return send(res, 200, getDeal(dealId(m[1])));
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)\/stock$/)) && method === "POST") {
    const by = asAuthor(need(req, "stock", "report stock"));
    const id = dealId(m[1]);
    const b = await readJson(req);
    const stock = oneOf<Stock>(b.stock, STOCK_LEVELS, "stock");
    const wait = stockWait(id, by);
    if (wait) throw new HttpError(429, `You just reported this. Try again in ${wait}s.`, { retryAfter: wait });
    reportStock(id, stock, by);
    broadcast({ type: "deal", id });
    return send(res, 200, getDeal(id));
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)\/comments$/))) {
    const id = dealId(m[1]);
    if (method === "GET") return send(res, 200, listComments(id));
    if (method === "POST") {
      const by = asAuthor(need(req, "comment", "comment"));
      const b = await readJson(req);
      const comment = addComment(id, str(b.body, "comment", 1, 500), by);
      broadcast({ type: "deal", id });
      return send(res, 201, comment);
    }
  }

  if (path.startsWith("/api/")) throw new HttpError(404, "not found");

  if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
  if (path === "/readme") {
    res.writeHead(301, { location: "/readme/" });
    return void res.end();
  }
  if (path === "/readme/") return sendReadme(res);
  if (path.startsWith("/readme/docs/")) return sendFile(req, res, "docs", path.slice("/readme/docs/".length));
  return sendFile(req, res, "public", path === "/" ? "index.html" : path.slice(1));
}

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    if (err instanceof HttpError) {
      if (req.url?.startsWith("/api/")) return send(res, err.status, { error: err.message, ...err.extra });
      res.writeHead(err.status, { "content-type": "text/plain; charset=utf-8" });
      return void res.end(err.message);
    }
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "something went wrong on our end" });
    else res.end();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`listening on 0.0.0.0:${PORT}`));

// every write is already committed, so there's nothing to flush on the way out
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => process.exit(0));
}
