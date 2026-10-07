import type { IncomingMessage, ServerResponse } from "node:http";

// Live updates over Server-Sent Events: one long-lived GET per open page. The
// server only says *which* deal changed (or that a poster has news); the page
// then fetches what it is allowed to see, so nothing private rides this stream
// and a guest can listen like anyone else.

export type LiveEvent =
  | { type: "new"; id: number } // just posted: only pages on page one need to look again
  | { type: "deal"; id: number } // changed: stock, confirmation, correction, comment
  | { type: "deleted"; id: number }
  | { type: "notice" }; // sent only to the poster it concerns

// 256 MB machine: cap listeners rather than let them pile up.
const MAX_LISTENERS = 300;
const HEARTBEAT_MS = 25_000;

const listeners = new Map<ServerResponse, string | null>(); // response -> user id, if logged in

export function listen(req: IncomingMessage, res: ServerResponse, userId: string | null): boolean {
  if (listeners.size >= MAX_LISTENERS) return false;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  res.write("retry: 3000\n\n"); // reconnect quickly if the connection drops
  listeners.set(res, userId);
  req.on("close", () => listeners.delete(res));
  return true;
}

const frame = (e: LiveEvent): string => `data: ${JSON.stringify(e)}\n\n`;

export function broadcast(e: LiveEvent): void {
  for (const res of listeners.keys()) res.write(frame(e));
}

export function tell(userId: string, e: LiveEvent): void {
  for (const [res, id] of listeners) if (id === userId) res.write(frame(e));
}

// A comment line every so often keeps proxies from closing a quiet connection.
setInterval(() => {
  for (const res of listeners.keys()) res.write(": ping\n\n");
}, HEARTBEAT_MS).unref();
