import { createHash, randomUUID } from "node:crypto";
import { inject } from "vitest";

// Shared by the spec files that talk to the API. Not a test file itself.

export const baseUrl = inject("baseUrl");

// Tests that write run against a local app or CI's throwaway container,
// never the live site, so real users never see test specials in their feed.
// SPEC_WRITES=1 overrides that, on purpose only.
export const writes =
  ["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname) || process.env.SPEC_WRITES === "1";

// A person, as a browser holds them: a secret key and a nickname. `public`
// is what the server shows everyone else (server/server.ts publicId).
export function person(name: string) {
  const key = `spec-${randomUUID()}`;
  return {
    key,
    name,
    public: { id: createHash("sha256").update(key).digest("hex").slice(0, 16), name },
    as: { key, name },
  };
}
export type Person = ReturnType<typeof person>;

export async function call(path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(
    new URL(path, baseUrl),
    body === undefined
      ? undefined
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  return { status: res.status, data: await res.json() };
}

// A unique item name, so tests never collide with each other or with real posts.
export const uniqueItem = (label = "spec item") => `${label} ${randomUUID().slice(0, 8)}`;

export const special = (by: Person, over: Record<string, unknown> = {}) => ({
  storeId: "coles-civic",
  item: uniqueItem(),
  wasCents: 550,
  nowCents: 275,
  endsOn: null,
  stock: "plenty",
  source: "in-store",
  author: by.as,
  ...over,
});
