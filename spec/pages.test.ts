import { describe, expect, it } from "vitest";
import { call, person, special, wholeFeed, writes } from "./api.ts";

// The feed comes a page at a time, each carrying on after the last deal of the
// one before (/api/deals?after=ID), so every live post can be reached however
// many there are; one response once stopped at 200, and the sold-out posts,
// sorted last, fell off the end. Carrying on after a deal rather than after a
// count means posts arriving meanwhile don't make a page repeat one.

const PAGE = 100; // FEED_PAGE in server/server.ts

describe("the feed in pages", () => {
  it("never sends more than a page, and nothing after the last deal", async () => {
    const first = await call("/api/deals");
    expect(first.status).toBe(200);
    expect(first.data.length).toBeLessThanOrEqual(PAGE);
    const all = await wholeFeed("/api/deals");
    if (all.length) expect(await call(`/api/deals?after=${all.at(-1).id}`)).toEqual({ status: 200, data: [] });
  });

  it("refuses an after that isn't a deal's id", async () => {
    for (const bad of ["0", "-1", "1.5", "ten", "99999999999", "9999999"]) {
      expect((await call(`/api/deals?after=${bad}`)).status, bad).toBe(400);
    }
  });

  // Other spec files change stock while this walks, which can move a post
  // between pages; so the order is checked within each page, and repeats are
  // the next test's business.
  it.skipIf(!writes)("reaches every live post across the pages, sold-out ones last", async () => {
    const poster = await person("spec pager");
    const shopper = await person("spec pager shop");
    const { data: gone } = await call("/api/deals", special(poster));
    const { data: fresh } = await call("/api/deals", special(poster));
    expect((await call(`/api/deals/${gone.id}/stock`, { stock: "gone", author: shopper.as })).status).toBe(200);

    const ids: number[] = [];
    for (let after = ""; ; ) {
      const { data: page } = await call(`/api/deals?store=coles-civic${after}`);
      if (!page.length) break;
      const firstGone = page.findIndex((d: any) => d.stock === "gone");
      if (firstGone >= 0) expect(page.slice(firstGone).every((d: any) => d.stock === "gone")).toBe(true);
      ids.push(...page.map((d: any) => d.id));
      after = `&after=${page.at(-1).id}`;
    }
    expect(ids).toContain(fresh.id);
    expect(ids).toContain(gone.id);
  });

  it.skipIf(!writes)("doesn't repeat a deal when someone posts between pages", async () => {
    const poster = await person("spec pager new");
    const first = await call("/api/deals?store=coles-civic");
    await call("/api/deals", special(poster)); // lands on top, before the cursor
    const next = await call(`/api/deals?store=coles-civic&after=${first.data.at(-1).id}`);
    const firstIds = new Set(first.data.map((d: any) => d.id));
    expect(next.data.filter((d: any) => firstIds.has(d.id))).toEqual([]);
  });
});
