import { describe, expect, it } from "vitest";
import { call, person, special, writes } from "./api.ts";

// Crit 8's "it's alive": a stranger can do the core thing (post a special,
// report stock, comment) and find their trace still there when they come back.
// "Coming back" here is a fresh request from someone else entirely.

const poster = person("spec poster");
const passerby = person("spec passerby");

describe.skipIf(!writes)("a stranger's trace is still there when they come back", () => {
  it("a posted special shows up for everyone, under its store", async () => {
    const posted = await call("/api/deals", special(poster));
    expect(posted.status).toBe(201);

    const all = await call("/api/deals");
    const atStore = await call("/api/deals?store=coles-civic");
    for (const feed of [all.data, atStore.data]) {
      const found = feed.find((d: any) => d.id === posted.data.id);
      expect(found).toMatchObject({ item: posted.data.item, nowCents: 275, wasCents: 550, author: poster.public });
    }
  });

  it("someone else's stock report and comment stick, with their name on them", async () => {
    const { data: deal } = await call("/api/deals", special(poster));

    expect((await call(`/api/deals/${deal.id}/stock`, { stock: "gone", author: passerby.as })).status).toBe(200);
    expect((await call(`/api/deals/${deal.id}/comments`, { body: "all gone by 5pm", author: passerby.as })).status).toBe(201);

    const { data: later } = await call(`/api/deals/${deal.id}`);
    expect(later).toMatchObject({ stock: "gone", stockBy: passerby.public, comments: 1 });
    const { data: comments } = await call(`/api/deals/${deal.id}/comments`);
    expect(comments).toEqual([expect.objectContaining({ body: "all gone by 5pm", author: passerby.public })]);
  });

  it("a 'special' that isn't cheaper is refused, and never reaches the feed", async () => {
    const item = `spec not-a-deal ${crypto.randomUUID().slice(0, 8)}`;
    const res = await call("/api/deals", special(poster, { item, wasCents: 200, nowCents: 300 }));
    expect(res.status).toBe(400);
    expect((await call("/api/deals")).data.some((d: any) => d.item === item)).toBe(false);
  });

  it("nobody's secret key ever appears in what the server sends back", async () => {
    const { data: deal } = await call("/api/deals", special(poster));
    await call(`/api/deals/${deal.id}/comments`, { body: "hi", author: passerby.as });
    const everything = JSON.stringify([
      (await call("/api/deals")).data,
      (await call(`/api/deals/${deal.id}/comments`)).data,
    ]);
    expect(everything).not.toContain(poster.key);
    expect(everything).not.toContain(passerby.key);
  });
});
