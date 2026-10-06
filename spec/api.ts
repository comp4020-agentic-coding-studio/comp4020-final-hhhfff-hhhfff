import { randomUUID } from "node:crypto";
import { inject } from "vitest";

// Shared by the spec files that talk to the API. Not a test file itself.

export const baseUrl = inject("baseUrl");

// Tests that write run against a local app or CI's throwaway container,
// never the live site, so real users never see test specials in their feed.
// SPEC_WRITES=1 overrides that, on purpose only.
export const writes =
  ["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname) || process.env.SPEC_WRITES === "1";

// A person is a registered account. `as` carries their session cookie;
// pass it in a request body as `author` (or as call()'s third argument) and
// the request goes out as them. Without it the request is a guest's.
export interface Person {
  name: string;
  public: { id: string; name: string };
  as: { cookie: string };
}

export async function person(label: string): Promise<Person> {
  const name = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 16)}-${randomUUID().slice(0, 6)}`;
  const res = await fetch(new URL("/api/register", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: name, password: "spec-password-1" }),
  });
  if (res.status !== 201) throw new Error(`registering ${name}: ${res.status} ${await res.text()}`);
  const user = await res.json();
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { name, public: { id: user.id, name: user.name }, as: { cookie } };
}

export async function call(
  path: string,
  body?: any,
  as?: { cookie: string },
): Promise<{ status: number; data: any }> {
  const cookie = (as ?? body?.author)?.cookie;
  const headers: Record<string, string> = cookie ? { cookie } : {};
  let init: RequestInit | undefined = cookie ? { headers } : undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init = { method: "POST", headers, body: JSON.stringify({ ...body, author: undefined }) };
  }
  const res = await fetch(new URL(path, baseUrl), init);
  return { status: res.status, data: await res.json() };
}

// A unique item name, so tests never collide with each other or with real posts.
export const uniqueItem = (label = "spec item") => `${label} ${randomUUID().slice(0, 8)}`;

export const special = (by: Person | undefined, over: Record<string, unknown> = {}) => ({
  storeId: "coles-civic",
  item: uniqueItem(),
  wasCents: 550,
  nowCents: 275,
  endsOn: null,
  stock: "plenty",
  source: "in-store",
  author: by?.as,
  ...over,
});
