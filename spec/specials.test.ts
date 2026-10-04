import { describe, expect, inject, it } from "vitest";

// Crit 8's "it's alive": a stranger can do the core thing (post a special,
// report stock, comment) and find their trace still there when they come back.
// "Coming back" here is a fresh request from someone else entirely.
//
// These tests write. They run against a local app or CI's throwaway container,
// never the live site, so real users never see test specials in their feed.
// SPEC_WRITES=1 overrides that, on purpose only.
const baseUrl = inject("baseUrl");
const local = ["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname);
const writes = local || process.env.SPEC_WRITES === "1";

const poster = { id: `spec-${crypto.randomUUID()}`, name: "spec poster" };
const passerby = { id: `spec-${crypto.randomUUID()}`, name: "spec passerby" };

async function call(path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(new URL(path, baseUrl), body === undefined
    ? undefined
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

const special = (over: Record<string, unknown> = {}) => ({
  storeId: "coles-civic",
  item: `spec item ${crypto.randomUUID().slice(0, 8)}`,
  wasCents: 550,
  nowCents: 275,
  endsOn: null,
  stock: "plenty",
  source: "in-store",
  author: poster,
  ...over,
});

describe.skipIf(!writes)("a stranger's trace is still there when they come back", () => {
  it("a posted special shows up for everyone, under its store", async () => {
    const posted = await call("/api/deals", special());
    expect(posted.status).toBe(201);

    const all = await call("/api/deals");
    const atStore = await call("/api/deals?store=coles-civic");
    for (const feed of [all.data, atStore.data]) {
      const found = feed.find((d: any) => d.id === posted.data.id);
      expect(found).toMatchObject({ item: posted.data.item, nowCents: 275, wasCents: 550, author: poster });
    }
  });

  it("someone else's stock report and comment stick, with their name on them", async () => {
    const { data: deal } = await call("/api/deals", special());

    expect((await call(`/api/deals/${deal.id}/stock`, { stock: "gone", author: passerby })).status).toBe(200);
    expect((await call(`/api/deals/${deal.id}/comments`, { body: "all gone by 5pm", author: passerby })).status).toBe(201);

    const { data: later } = await call(`/api/deals/${deal.id}`);
    expect(later).toMatchObject({ stock: "gone", stockBy: passerby, comments: 1 });
    const { data: comments } = await call(`/api/deals/${deal.id}/comments`);
    expect(comments).toEqual([expect.objectContaining({ body: "all gone by 5pm", author: passerby })]);
  });

  it("a 'special' that isn't cheaper is refused, and never reaches the feed", async () => {
    const item = `spec not-a-deal ${crypto.randomUUID().slice(0, 8)}`;
    const res = await call("/api/deals", special({ item, wasCents: 200, nowCents: 300 }));
    expect(res.status).toBe(400);
    expect((await call("/api/deals")).data.some((d: any) => d.item === item)).toBe(false);
  });
});
