import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { marked } from "marked";
import {
  addComment,
  createDeal,
  getDeal,
  listComments,
  listDeals,
  reportStock,
  SOURCES,
  STOCK_LEVELS,
  type Author,
  type Source,
  type Stock,
} from "./db.ts";
import { STORES, storeById } from "./stores.ts";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY = 8 * 1024;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

function author(v: unknown): Author {
  const a = (v ?? {}) as Record<string, unknown>;
  if (typeof a.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(a.id)) {
    throw new HttpError(400, "author id is missing or malformed");
  }
  return { id: a.id, name: str(a.name, "nickname", 1, 24) };
}

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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
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
};

async function sendFile(res: ServerResponse, root: string, rel: string): Promise<void> {
  const path = normalize(join(root, rel));
  if (!path.startsWith(normalize(root))) throw new HttpError(404, "not found");
  let data: Buffer;
  try {
    data = await readFile(path);
  } catch {
    throw new HttpError(404, "not found");
  }
  res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
  res.end(data);
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
<link rel="stylesheet" href="/styles.css">
</head>
<body class="readme">
<nav><a href="/">← Back to the specials</a></nav>
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

  if (method === "GET" && path === "/api/stores") return send(res, 200, STORES);

  if (method === "GET" && path === "/api/deals") {
    const store = url.searchParams.get("store");
    if (store && !storeById.has(store)) throw new HttpError(404, "no such store");
    return send(res, 200, listDeals(store, todayInCanberra()));
  }

  if (method === "POST" && path === "/api/deals") {
    const b = await readJson(req);
    const storeId = typeof b.storeId === "string" && storeById.has(b.storeId) ? b.storeId : null;
    if (!storeId) throw new HttpError(400, "pick a store");
    const wasCents = cents(b.wasCents, "usual price");
    const nowCents = cents(b.nowCents, "special price");
    if (nowCents >= wasCents) throw new HttpError(400, "the special price has to be lower than the usual price");
    const deal = createDeal({
      storeId,
      item: str(b.item, "item", 2, 80),
      wasCents,
      nowCents,
      endsOn: endsOn(b.endsOn),
      stock: oneOf<Stock>(b.stock, STOCK_LEVELS, "stock"),
      source: oneOf<Source>(b.source, SOURCES, "source"),
      author: author(b.author),
    });
    return send(res, 201, deal);
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)$/)) && method === "GET") {
    return send(res, 200, getDeal(dealId(m[1])));
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)\/stock$/)) && method === "POST") {
    const id = dealId(m[1]);
    const b = await readJson(req);
    reportStock(id, oneOf<Stock>(b.stock, STOCK_LEVELS, "stock"), author(b.author));
    return send(res, 200, getDeal(id));
  }

  if ((m = path.match(/^\/api\/deals\/(\d+)\/comments$/))) {
    const id = dealId(m[1]);
    if (method === "GET") return send(res, 200, listComments(id));
    if (method === "POST") {
      const b = await readJson(req);
      return send(res, 201, addComment(id, str(b.body, "comment", 1, 500), author(b.author)));
    }
  }

  if (path.startsWith("/api/")) throw new HttpError(404, "not found");

  if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
  if (path === "/readme") {
    res.writeHead(301, { location: "/readme/" });
    return void res.end();
  }
  if (path === "/readme/") return sendReadme(res);
  if (path.startsWith("/readme/docs/")) return sendFile(res, "docs", path.slice("/readme/docs/".length));
  return sendFile(res, "public", path === "/" ? "index.html" : path.slice(1));
}

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    if (err instanceof HttpError) {
      if (req.url?.startsWith("/api/")) return send(res, err.status, { error: err.message });
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
