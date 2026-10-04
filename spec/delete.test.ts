import { describe, expect, it } from "vitest";
import { call, person, special, writes } from "./api.ts";

// A poster can take their own post down, even after others have added to it;
// nobody else can. A deleted post is gone from everything people can see or
// act on (the database keeps it, hidden, with what others added).

const remove = (dealId: number, by: { as: unknown }) => call(`/api/deals/${dealId}/delete`, { author: by.as });

describe.skipIf(!writes)("deleting a post", () => {
  it("only the poster can delete it: not someone else, not someone holding the poster's public id", async () => {
    const poster = person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));

    expect((await remove(deal.id, person("spec stranger"))).status).toBe(403);
    expect((await remove(deal.id, { as: { key: deal.author.id, name: poster.name } })).status).toBe(403);
    expect((await call(`/api/deals/${deal.id}`)).status).toBe(200);
  });

  it("the poster can delete it even after others confirmed, commented and suggested corrections", async () => {
    const poster = person("spec poster");
    const other = person("spec other");
    const { data: deal } = await call("/api/deals", special(poster));
    await call(`/api/deals/${deal.id}/confirm`, { author: other.as });
    await call(`/api/deals/${deal.id}/comments`, { body: "nice find", author: other.as });
    await call(`/api/deals/${deal.id}/corrections`, { field: "nowCents", value: 300, author: other.as });

    expect((await remove(deal.id, poster)).status).toBe(200);
  });

  it("a deleted post is gone from the feed, the duplicate check, and can't be acted on", async () => {
    const poster = person("spec poster");
    const other = person("spec other");
    const { data: deal } = await call("/api/deals", special(poster));
    await remove(deal.id, poster);

    expect((await call("/api/deals")).data.some((d: any) => d.id === deal.id)).toBe(false);
    expect((await call("/api/deals?store=coles-civic")).data.some((d: any) => d.id === deal.id)).toBe(false);
    const similar = await call(`/api/deals/similar?store=coles-civic&item=${encodeURIComponent(deal.item)}`);
    expect(similar.data.some((d: any) => d.id === deal.id)).toBe(false);

    expect((await call(`/api/deals/${deal.id}`)).status).toBe(404);
    expect((await call(`/api/deals/${deal.id}/comments`, { body: "hello?", author: other.as })).status).toBe(404);
    expect((await call(`/api/deals/${deal.id}/confirm`, { author: other.as })).status).toBe(404);
    expect((await call(`/api/deals/${deal.id}/stock`, { stock: "gone", author: other.as })).status).toBe(404);
    expect((await remove(deal.id, poster)).status).toBe(404);
  });

  it("after deleting, the poster can post the same item there again", async () => {
    const poster = person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    await remove(deal.id, poster);
    expect((await call("/api/deals", special(poster, { item: deal.item }))).status).toBe(201);
  });
});
