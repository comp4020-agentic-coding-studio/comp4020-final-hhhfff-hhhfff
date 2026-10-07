import { describe, expect, it } from "vitest";
import { call, person, special, uniqueItem, wholeFeed, writes } from "./api.ts";

// One special, one post: nobody can post an item at a store where it already
// has a live post, a poster is shown what's already there before posting, and
// wrong details are fixed by the crowd rather than by posting again.

describe.skipIf(!writes)("one live post per item per store", () => {
  it("refuses a second post of the same item at the same store, however it's written", async () => {
    const me = await person("spec repeater");
    const item = uniqueItem("Tim Tams 200g");
    const first = await call("/api/deals", special(me, { item }));
    expect(first.status).toBe(201);

    const again = await call("/api/deals", special(me, { item: item.toUpperCase().replace("200g", "200 g") }));
    expect(again.status).toBe(409);
    expect(again.data.existing.id).toBe(first.data.id);

    const feed = await wholeFeed("/api/deals?store=coles-civic");
    expect(feed.filter((d: any) => d.author.id === me.public.id)).toHaveLength(1);
  });

  it("lets it be posted at another store, but not by someone else at the same store", async () => {
    const me = await person("spec shopper");
    const item = uniqueItem("Bananas 1kg");
    const first = await call("/api/deals", special(me, { item }));
    expect(first.status).toBe(201);
    expect((await call("/api/deals", special(me, { item, storeId: "aldi-civic" }))).status).toBe(201);

    const theirs = await call("/api/deals", special(await person("spec other"), { item: `  ${item.toLowerCase()} ` }));
    expect(theirs.status).toBe(409);
    expect(theirs.data.existing.id).toBe(first.data.id);
    expect(theirs.data.error).toContain("confirm or correct");
  });

  it("when several people post the same thing at the same moment, exactly one gets in", async () => {
    const item = uniqueItem("Rice 5kg");
    const people = await Promise.all([1, 2, 3, 4, 5].map((n) => person(`spec racer ${n}`)));
    const results = await Promise.all(people.map((p) => call("/api/deals", special(p, { item }))));

    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).map((r) => r.data.existing.id)).toEqual(
      Array(4).fill(created[0].data.id),
    );
    const feed = await wholeFeed("/api/deals?store=coles-civic");
    expect(feed.filter((d: any) => d.item === item)).toHaveLength(1);
  });

  it("once the live post is deleted, someone else can post it there", async () => {
    const poster = await person("spec poster");
    const item = uniqueItem("Oat milk 1L");
    const { data: deal } = await call("/api/deals", special(poster, { item }));
    await call(`/api/deals/${deal.id}/delete`, { author: poster.as });
    expect((await call("/api/deals", special(await person("spec next"), { item }))).status).toBe(201);
  });

  it("a correction can't rename a post into a second live post for an item", async () => {
    const [a, b] = [await person("spec a"), await person("spec b")];
    const taken = uniqueItem("Eggs 12pk");
    await call("/api/deals", special(a, { item: taken }));
    const { data: other } = await call("/api/deals", special(b));

    // the poster's own correction would apply at once, so it is the sharpest case
    const res = await call(`/api/deals/${other.id}/corrections`, { field: "item", value: taken, author: b.as });
    expect(res.status).toBe(409);
    expect((await call(`/api/deals/${other.id}`)).data.item).toBe(other.item);
  });
});

describe.skipIf(!writes)("before posting, the poster sees what's already there", () => {
  it("finds a close match at the same store, and not at a different one", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    const { data: posted } = await call("/api/deals", special(await person("spec first"), { item: `Zorbo${tag} biscuits 200g` }));

    const near = await call(`/api/deals/similar?store=coles-civic&item=${encodeURIComponent(`200g zorbo${tag} biscuit`)}`);
    expect(near.status).toBe(200);
    expect(near.data.map((d: any) => d.id)).toContain(posted.id);

    const elsewhere = await call(`/api/deals/similar?store=aldi-civic&item=${encodeURIComponent(`Zorbo${tag} biscuits 200g`)}`);
    expect(elsewhere.data.map((d: any) => d.id)).not.toContain(posted.id);
  });

  it("'same and correct' is a confirmation: once per person, and not by the poster", async () => {
    const poster = await person("spec poster");
    const fan = await person("spec fan");
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
    const poster = await person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster, { nowCents: 275 }));
    const [a, b, c] = [await person("spec a"), await person("spec b"), await person("spec c")];

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
    const { data: deal } = await call("/api/deals", special(await person("spec poster")));
    await correct(deal.id, await person("spec a"), "nowCents", 300);
    await correct(deal.id, await person("spec b"), "nowCents", 310);
    const r = await correct(deal.id, await person("spec c"), "nowCents", 320);
    expect(r.data.applied).toBe(false);
    expect((await call(`/api/deals/${deal.id}`)).data.pending).toHaveLength(3);
  });

  it("the poster's own correction applies at once, with no notice to themselves", async () => {
    const poster = await person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    expect((await correct(deal.id, poster, "endsOn", "2099-12-31")).data.applied).toBe(true);
    expect((await call(`/api/deals/${deal.id}`)).data).toMatchObject({ endsOn: "2099-12-31" });
    expect((await call("/api/notifications", { author: poster.as })).data).toEqual([]);
  });

  it("knowing the poster's public id doesn't let you correct as them", async () => {
    const poster = await person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    const impostor = { as: { cookie: `sid=${deal.author.id}` } };
    expect((await correct(deal.id, impostor, "nowCents", 100)).status).toBe(401);
    expect((await call(`/api/deals/${deal.id}`)).data.nowCents).toBe(275);
  });

  it("a correction can't make the special dearer than the usual price", async () => {
    const poster = await person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster, { wasCents: 550, nowCents: 275 }));
    expect((await correct(deal.id, poster, "nowCents", 600)).status).toBe(400);
  });
});
