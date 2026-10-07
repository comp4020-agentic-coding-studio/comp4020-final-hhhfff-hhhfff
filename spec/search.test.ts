import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { call, person, special, writes } from "./api.ts";

// Search runs on the server (/api/deals?q=), so it finds posts past the feed's
// first 200. Every word must match the item or the shop (name, suburb or kind:
// "asian" finds the Asian grocers); a word can be whole, the start of one,
// inside one (Chinese has no spaces) or a letter off. Closer matches come
// first, sold-out posts still last. Anyone can search; it changes nothing.

// One made-up word, letters only, ties each search to this file's posts
// whatever else is in the feed.
const tag = "zq" + [...randomUUID().replace(/-/g, "")].map((c) => (/\d/.test(c) ? "ghijklmnop"[+c] : c)).join("").slice(0, 8);

const ids = (data: any[]) => data.map((d) => d.id);
const search = async (q: string, store?: string) => {
  const params = new URLSearchParams({ q, ...(store ? { store } : {}) });
  const res = await call(`/api/deals?${params}`);
  expect(res.status).toBe(200);
  return ids(res.data);
};

describe.skipIf(!writes)("searching the specials", async () => {
  const poster = await person("spec searcher");
  const post = async (item: string, storeId: string) => {
    const res = await call("/api/deals", special(poster, { item: `${item} ${tag}`, storeId }));
    expect(res.status).toBe(201);
    return res.data.id as number;
  };
  const timTams = await post("Tim Tams 200g", "coles-civic");
  const dumplings = await post("Pork Dumplings", "daily-market-childers");
  const oatMilk = await post("Oat Milk 1L", "coles-civic");
  const wrappers = await post("Dumpling wrappers", "aldi-civic");
  const jiaozi = await post("饺子", "swan-dickson");
  // someone else: posting counts as the poster's stock report for the minute
  const shopper = await person("spec shopper");
  expect((await call(`/api/deals/${oatMilk}/stock`, { stock: "gone", author: shopper.as })).status).toBe(200);

  it("finds an item by a whole word, its start, or across case, punctuation and spaces", async () => {
    for (const q of [`tim ${tag}`, `TIM-TAMS ${tag}`, `tam ${tag}`, `timtams ${tag}`, `200 g ${tag}`]) {
      expect(await search(q), q).toEqual([timTams]);
    }
  });

  it("still finds it with a letter wrong or missing", async () => {
    expect(await search(`dumplngs ${tag}`)).toContain(dumplings);
    expect(await search(`tim tems ${tag}`)).toEqual([timTams]);
  });

  it("needs every word to match, in the item or the shop's name, suburb or kind", async () => {
    expect(new Set(await search(`${tag} coles`))).toEqual(new Set([timTams, oatMilk]));
    expect(await search(`${tag} daily market`)).toEqual([dumplings]);
    expect(await search(`${tag} dickson`)).toEqual([jiaozi]);
    expect(new Set(await search(`${tag} asian`))).toEqual(new Set([dumplings, jiaozi]));
    expect(await search(`${tag} tim dumplings`)).toEqual([]);
  });

  it("finds Chinese item names, which have no spaces between words", async () => {
    expect(await search(`饺子 ${tag}`)).toEqual([jiaozi]);
    expect(await search(`子 ${tag}`)).toEqual([jiaozi]);
  });

  it("puts closer matches first, and sold-out posts after the rest", async () => {
    expect(await search(`dumplings ${tag}`)).toEqual([dumplings, wrappers]);
    expect(await search(`${tag} coles`)).toEqual([timTams, oatMilk]);
  });

  it("works with the store filter, and leaves deleted posts out", async () => {
    expect(new Set(await search(tag, "coles-civic"))).toEqual(new Set([timTams, oatMilk]));
    const gone = await post("Instant noodles", "coles-civic");
    expect(await search(`noodles ${tag}`)).toEqual([gone]);
    expect((await call(`/api/deals/${gone}/delete`, {}, poster.as)).status).toBe(200);
    expect(await search(`noodles ${tag}`)).toEqual([]);
  });
});

describe("what a search accepts", () => {
  it("refuses a search longer than 80 characters", async () => {
    expect((await call(`/api/deals?q=${"a".repeat(81)}`)).status).toBe(400);
  });

  it("treats a blank search as no search, and punctuation alone as matching nothing", async () => {
    // (other spec files post meanwhile, so this compares sizes, not the lists)
    const [blank, none] = await Promise.all([call("/api/deals?q=%20%20"), call("/api/deals")]);
    expect(blank.status).toBe(200);
    expect(Math.abs(blank.data.length - none.data.length)).toBeLessThanOrEqual(5);
    expect(await search("!!! ...")).toEqual([]);
  });

  it("still refuses an unknown store", async () => {
    expect((await call("/api/deals?q=milk&store=nowhere")).status).toBe(404);
  });
});
