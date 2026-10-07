import { describe, expect, it } from "vitest";
import { baseUrl, call, person, special, wholeFeed, writes } from "./api.ts";

// The feed comes a page at a time: numbered pages for the page to show
// (/api/deals?page=N&per=10, counted by x-total-count), and for reading it all,
// each page carrying on after the last deal of the one before
// (/api/deals?after=ID). Every live post can be reached however many there
// are; one response once stopped at 200, and the sold-out posts, sorted last,
// fell off the end. Carrying on after a deal rather than after a count means
// posts arriving meanwhile don't make a page repeat one.

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

  // The page shows numbered pages of ten, numbered by the total the server
  // counts. A made-up word in every item keeps other spec files' posts out.
  it.skipIf(!writes)("gives numbered pages of ten, with the total to number them by", async () => {
    const poster = await person("spec numbered");
    const tag = `pg${crypto.randomUUID().replace(/[^a-f]/g, "").slice(0, 8)}x`;
    const posted: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await call("/api/deals", special(poster, { item: `Page test ${i} ${tag}` }));
      expect(res.status).toBe(201);
      posted.push(res.data.id);
    }
    const pageOf = async (n: number) => {
      const res = await fetch(new URL(`/api/deals?q=${tag}&per=10&page=${n}`, baseUrl));
      expect(res.status).toBe(200);
      return { total: res.headers.get("x-total-count"), ids: (await res.json()).map((d: any) => d.id) as number[] };
    };
    const [one, two, three] = [await pageOf(1), await pageOf(2), await pageOf(3)];
    expect([one.total, two.total, three.total]).toEqual(["12", "12", "12"]);
    expect([one.ids.length, two.ids.length, three.ids.length]).toEqual([10, 2, 0]);
    expect(new Set([...one.ids, ...two.ids])).toEqual(new Set(posted));
    expect(one.ids[0]).toBe(posted.at(-1)); // newest first
  });

  it("refuses a page or page size out of range, or a page with a cursor", async () => {
    for (const bad of ["page=0", "page=-2", "page=x", "per=0", "per=101", "per=1.5", "page=2&after=1"]) {
      expect((await call(`/api/deals?${bad}`)).status, bad).toBe(400);
    }
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
