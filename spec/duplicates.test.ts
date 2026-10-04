import { describe, expect, it } from "vitest";
import { call, person, special, uniqueItem, writes } from "./api.ts";

// One special, one post: a person can't post the same item at the same store
// twice, a poster is shown what's already there before posting, and wrong
// details are fixed by the crowd rather than by posting again.

describe.skipIf(!writes)("one person, one post per item per store", () => {
  it("refuses a second post of the same item at the same store, however it's written", async () => {
    const me = person("spec repeater");
    const item = uniqueItem("Tim Tams 200g");
    const first = await call("/api/deals", special(me, { item }));
    expect(first.status).toBe(201);

    const again = await call("/api/deals", special(me, { item: item.toUpperCase().replace("200g", "200 g") }));
    expect(again.status).toBe(409);
    expect(again.data.existing.id).toBe(first.data.id);

    const feed = (await call("/api/deals?store=coles-civic")).data;
    expect(feed.filter((d: any) => d.author.id === me.public.id)).toHaveLength(1);
  });

  it("still lets the same person post it at another store, and someone else post it here", async () => {
    const me = person("spec shopper");
    const item = uniqueItem("Bananas 1kg");
    expect((await call("/api/deals", special(me, { item }))).status).toBe(201);
    expect((await call("/api/deals", special(me, { item, storeId: "aldi-civic" }))).status).toBe(201);
    expect((await call("/api/deals", special(person("spec other"), { item }))).status).toBe(201);
  });
});

describe.skipIf(!writes)("before posting, the poster sees what's already there", () => {
  it("finds a close match at the same store, and not at a different one", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    const { data: posted } = await call("/api/deals", special(person("spec first"), { item: `Zorbo${tag} biscuits 200g` }));

    const near = await call(`/api/deals/similar?store=coles-civic&item=${encodeURIComponent(`200g zorbo${tag} biscuit`)}`);
    expect(near.status).toBe(200);
    expect(near.data.map((d: any) => d.id)).toContain(posted.id);

    const elsewhere = await call(`/api/deals/similar?store=aldi-civic&item=${encodeURIComponent(`Zorbo${tag} biscuits 200g`)}`);
    expect(elsewhere.data.map((d: any) => d.id)).not.toContain(posted.id);
  });

  it("'same and correct' is a confirmation: once per person, and not by the poster", async () => {
    const poster = person("spec poster");
    const fan = person("spec fan");
    const { data: deal } = await call("/api/deals", special(poster));

    expect((await call(`/api/deals/${deal.id}/confirm`, { author: fan.as })).status).toBe(201);
    expect((await call(`/api/deals/${deal.id}/confirm`, { author: fan.as })).status).toBe(200);
    expect((await call(`/api/deals/${deal.id}/confirm`, { author: poster.as })).status).toBe(400);

    const { data: later } = await call(`/api/deals/${deal.id}`);
    expect(later.confirmations).toBe(1);
    expect(later.confirmedBy).toEqual([fan.public]);
  });
});

describe.skipIf(!writes)("the crowd corrects a post", () => {
  const correct = (dealId: number, by: { as: unknown }, field: string, value: unknown, note?: string) =>
    call(`/api/deals/${dealId}/corrections`, { field, value, note, author: by.as });

  it("three different people agreeing rewrites the post and tells the poster; two don't", async () => {
    const poster = person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster, { nowCents: 275 }));
    const [a, b, c] = [person("spec a"), person("spec b"), person("spec c")];

    expect((await correct(deal.id, a, "nowCents", 300, "shelf tag says $3")).data).toMatchObject({ applied: false, votes: 1 });
    // saying it twice is still one person
    expect((await correct(deal.id, a, "nowCents", 300)).data).toMatchObject({ applied: false, votes: 1 });
    expect((await correct(deal.id, b, "nowCents", 300)).data).toMatchObject({ applied: false, votes: 2 });
    expect((await call(`/api/deals/${deal.id}`)).data.nowCents).toBe(275);

    const third = await correct(deal.id, c, "nowCents", 300);
    expect(third.data).toMatchObject({ applied: true, votes: 3 });
    const { data: after } = await call(`/api/deals/${deal.id}`);
    expect(after.nowCents).toBe(300);
    expect(after.pending).toEqual([]);
    expect(after.history).toEqual([expect.objectContaining({ field: "nowCents", from: 275, to: 300, by: "crowd" })]);

    const told = await call("/api/notifications", { author: poster.as });
    expect(told.data).toHaveLength(1);
    expect(told.data[0].text).toContain("$3.00");
    // told once, not every visit
    expect((await call("/api/notifications", { author: poster.as })).data).toEqual([]);
  });

  it("people suggesting different values don't add up", async () => {
    const { data: deal } = await call("/api/deals", special(person("spec poster")));
    await correct(deal.id, person("spec a"), "nowCents", 300);
    await correct(deal.id, person("spec b"), "nowCents", 310);
    const r = await correct(deal.id, person("spec c"), "nowCents", 320);
    expect(r.data.applied).toBe(false);
    expect((await call(`/api/deals/${deal.id}`)).data.pending).toHaveLength(3);
  });

  it("the poster's own correction applies at once, with no notice to themselves", async () => {
    const poster = person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    expect((await correct(deal.id, poster, "endsOn", "2099-12-31")).data.applied).toBe(true);
    expect((await call(`/api/deals/${deal.id}`)).data).toMatchObject({ endsOn: "2099-12-31" });
    expect((await call("/api/notifications", { author: poster.as })).data).toEqual([]);
  });

  it("knowing the poster's public id doesn't let you correct as them", async () => {
    const poster = person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    const impostor = { as: { key: deal.author.id, name: poster.name } };
    expect((await correct(deal.id, impostor, "nowCents", 100)).data.applied).toBe(false);
    expect((await call(`/api/deals/${deal.id}`)).data.nowCents).toBe(275);
  });

  it("a correction can't make the special dearer than the usual price", async () => {
    const poster = person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster, { wasCents: 550, nowCents: 275 }));
    expect((await correct(deal.id, poster, "nowCents", 600)).status).toBe(400);
  });
});
