import type { IncomingMessage } from "node:http";
import type { User } from "./auth.ts";

// The action log: one JSON line on stdout for each change someone asks the
// server for, refused ones included, which is what `flyctl logs` shows of the
// deployed app. It names who asked by account, as their session cookie says
// (or a guest), what they asked for, the post or comment it was done to and
// whose that is, and how the server answered. It holds identifiers, fixed
// words and what a post shows publicly: never a password, a hash, a session
// token, or the text of a comment or note (spec/log.test.ts).

type Detail = string | number | boolean | null;

interface Trail {
  path: string;
  who: User | null;
  did?: string;
  detail: Record<string, Detail>;
}

const trails = new WeakMap<IncomingMessage, Trail>();

// a page's own bookkeeping, sent as it loads and scrolls: nothing a person chose to do
const BOOKKEEPING = new Set(["/api/watch", "/api/notifications"]);

export const isAction = (method: string, path: string): boolean =>
  method === "POST" && path.startsWith("/api/") && !BOOKKEEPING.has(path);

// Starts the line for an action, with who the cookie names as it arrives, so
// a logout still says who logged out.
export function begin(req: IncomingMessage, path: string, who: User | null): void {
  trails.set(req, { path, who, detail: {} });
}

// Names what the request does, as soon as the route knows, so a refused one
// is named too; `record` adds what is learnt later, like a new post's id.
// Both do nothing for a request begin() didn't start, such as reading a photo.
export function act(req: IncomingMessage, did: string, detail: Record<string, Detail> = {}): void {
  const trail = trails.get(req);
  if (!trail) return;
  trail.did = did;
  Object.assign(trail.detail, detail);
}

export function record(req: IncomingMessage, detail: Record<string, Detail>): void {
  const trail = trails.get(req);
  if (trail) Object.assign(trail.detail, detail);
}

// the account a login or registration signs in, which the request's cookie didn't name
export function signedIn(req: IncomingMessage, user: User): void {
  const trail = trails.get(req);
  if (trail) trail.who = user;
}

// Writes the line once the answer has gone; `error` is why it was refused.
export function logAction(req: IncomingMessage, status: number, error?: string): void {
  const trail = trails.get(req);
  if (!trail) return;
  const { path, who, did, detail } = trail;
  console.log(
    JSON.stringify({
      log: "action",
      user: who?.name ?? null,
      role: who?.role ?? "guest",
      did: did ?? `POST ${path.slice(0, 80)}`,
      ...detail,
      status,
      ...(error === undefined ? {} : { error }),
    }),
  );
}
