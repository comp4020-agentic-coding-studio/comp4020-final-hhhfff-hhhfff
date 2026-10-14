import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// Live updates over Server-Sent Events: one long-lived GET per open page. The
// server only says *which* deal changed (or that a poster has news); the page
// then fetches what it is allowed to see, so nothing private rides this stream
// and a guest can listen like anyone else.

export type LiveEvent =
  | { type: "new"; id: number } // just posted: only pages on page one need to look again
  | { type: "deal"; id: number } // changed: stock, confirmation, correction, comment
  | { type: "deleted"; id: number }
  | { type: "notice" } // sent only to the poster it concerns
  | { type: "here" }; // who's looking changed: the page asks /api/here for the counts

// 256 MB machine: cap listeners rather than let them pile up.
const MAX_LISTENERS = 300;
const HEARTBEAT_MS = 25_000;

// What each open page is looking at ("deal:12", "store:coles-civic"), so the
// app can say how many people are on a post or a store. A person is counted
// once however many tabs they have open; a guest, once per page.
interface Listener {
  stream: string; // random, sent only down this connection, so the page can say what it's looking at
  user: string | null;
  watch: Set<string>;
}

const listeners = new Map<ServerResponse, Listener>();
const streams = new Map<string, ServerResponse>();

export function listen(req: IncomingMessage, res: ServerResponse, userId: string | null): boolean {
  if (listeners.size >= MAX_LISTENERS) return false;
  const stream = randomBytes(16).toString("hex");
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  res.write("retry: 3000\n\n"); // reconnect quickly if the connection drops
  res.write(`data: ${JSON.stringify({ type: "hello", stream })}\n\n`);
  listeners.set(res, { stream, user: userId, watch: new Set() });
  streams.set(stream, res);
  hereChanged();
  req.on("close", () => {
    listeners.delete(res);
    streams.delete(stream);
    hereChanged();
  });
  return true;
}

const frame = (e: LiveEvent): string => `data: ${JSON.stringify(e)}\n\n`;

export function broadcast(e: LiveEvent): void {
  for (const res of listeners.keys()) res.write(frame(e));
}

export function tell(userId: string, e: LiveEvent): void {
  for (const [res, l] of listeners) if (l.user === userId) res.write(frame(e));
}

// A page says what it's looking at. Only the person (or guest) who opened the
// stream can: a stream id from someone else's page changes nothing.
export function setWatch(stream: string, userId: string | null, watch: string[]): boolean {
  const res = streams.get(stream);
  const l = res && listeners.get(res);
  if (!l || l.user !== userId) return false;
  const next = new Set(watch);
  if (next.size === l.watch.size && [...next].every((w) => l.watch.has(w))) return true;
  l.watch = next;
  hereChanged();
  return true;
}

// How many people are here, and on each post and store someone is looking at.
// Counts only: never who. Worked out again only after something changed.
export interface Presence {
  here: number;
  deals: Record<string, number>;
  stores: Record<string, number>;
}

let cached: Presence | null = null;

export function presence(): Presence {
  if (cached) return cached;
  const person = (l: Listener) => (l.user ? `u:${l.user}` : `g:${l.stream}`);
  const people = new Set<string>();
  const on = new Map<string, Set<string>>();
  for (const l of listeners.values()) {
    people.add(person(l));
    for (const w of l.watch) (on.get(w) ?? on.set(w, new Set()).get(w)!).add(person(l));
  }
  const deals: Record<string, number> = {};
  const stores: Record<string, number> = {};
  for (const [w, who] of on) {
    const [kind, id] = w.split(":");
    (kind === "deal" ? deals : stores)[id] = who.size;
  }
  return (cached = { here: people.size, deals, stores });
}

// Pages joining and leaving can come in bursts; the "here" signal goes out at
// most every HERE_MS, so a busy minute is a handful of signals, not hundreds.
const HERE_MS = 1500;
let hereTimer: NodeJS.Timeout | null = null;

function hereChanged(): void {
  cached = null;
  if (hereTimer) return;
  hereTimer = setTimeout(() => {
    hereTimer = null;
    broadcast({ type: "here" });
  }, HERE_MS);
  hereTimer.unref();
}

// A comment line every so often keeps proxies from closing a quiet connection.
setInterval(() => {
  for (const res of listeners.keys()) res.write(": ping\n\n");
}, HEARTBEAT_MS).unref();
