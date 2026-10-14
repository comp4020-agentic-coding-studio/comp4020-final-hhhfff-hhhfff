import { describe, expect, it } from "vitest";
import { baseUrl, call, person, special, writes } from "./api.ts";
import { watch } from "./stream.ts";

// Who else is here: an open page can see how many people are on the site,
// and on a post or store it shows, so a special many are eyeing may be gone
// soon. Counts only, never who. A page names what it shows by its live
// stream's id, which is sent down that stream alone; the stream itself only
// says "here" when counts change, and the counts are read from /api/here.

const here = async () => (await call("/api/here")).data;
const hello = async (page: Awaited<ReturnType<typeof watch>>) => (await page.until((e) => e.type === "hello")).stream as string;
const until = async (what: string, ok: () => Promise<boolean>, ms = 5000) => {
  for (const start = Date.now(); !(await ok()); await new Promise((r) => setTimeout(r, 50))) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
  }
};

describe.skipIf(!writes)("who else is here", () => {
  it("counts people on a post, once each however many tabs, and drops them when they leave", async () => {
    const poster = await person("spec presence poster");
    const [amy, ben] = await Promise.all(["spec presence amy", "spec presence ben"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    const pages = [await watch(amy.as), await watch(amy.as), await watch(ben.as)];
    try {
      const streams = await Promise.all(pages.map(hello));
      for (const [i, who] of [amy, amy, ben].entries()) {
        expect((await call("/api/watch", { stream: streams[i], watch: [`deal:${deal.id}`], author: who.as })).status).toBe(200);
      }
      await until("two people on the post", async () => (await here()).deals[deal.id] === 2);

      pages[2].close(); // ben leaves
      await until("one person on the post", async () => (await here()).deals[deal.id] === 1);
      pages[1].close(); // amy closes one of her two tabs: still here
      await new Promise((r) => setTimeout(r, 300));
      expect((await here()).deals[deal.id]).toBe(1);
    } finally {
      pages.forEach((p) => p.close());
    }
  });

  it("counts people on a store's page, and guests once per page", async () => {
    const [a, b] = [await watch(), await watch()];
    try {
      const [sa, sb] = await Promise.all([hello(a), hello(b)]);
      await call("/api/watch", { stream: sa, watch: ["store:swan-dickson"] });
      await call("/api/watch", { stream: sb, watch: ["store:swan-dickson"] });
      await until("two guests on the store", async () => (await here()).stores["swan-dickson"] >= 2);
      expect((await here()).here).toBeGreaterThanOrEqual(2);
    } finally {
      a.close();
      b.close();
    }
  });

  it("tells open pages counts changed with a bare signal, and the counts name nobody", async () => {
    const poster = await person("spec presence names");
    const { data: deal } = await call("/api/deals", special(poster));
    const listener = await watch();
    const looker = await watch(poster.as);
    try {
      const stream = await hello(looker);
      await call("/api/watch", { stream, watch: [`deal:${deal.id}`], author: poster.as });
      const signal = await listener.until((e) => e.type === "here");
      expect(Object.keys(signal)).toEqual(["type"]);
      const counts = JSON.stringify(await here());
      for (const leak of [poster.name, poster.public.id, poster.as.cookie.slice(4), stream]) expect(counts).not.toContain(leak);
      // another page never hears this page's stream id
      expect(JSON.stringify(listener.events)).not.toContain(stream);
    } finally {
      listener.close();
      looker.close();
    }
  });

  it("only the page's own person can say what it shows; nonsense is refused", async () => {
    const [amy, ben] = await Promise.all(["spec presence owner", "spec presence other"].map(person));
    const page = await watch(amy.as);
    try {
      const stream = await hello(page);
      // ben, or a guest, holding amy's stream id changes nothing
      expect((await call("/api/watch", { stream, watch: ["store:coles-civic"], author: ben.as })).status).toBe(404);
      expect((await call("/api/watch", { stream, watch: ["store:coles-civic"] })).status).toBe(404);
      for (const bad of [
        { stream: "nope", watch: [] },
        { stream, watch: "deal:1" },
        { stream, watch: ["deal:abc"] },
        { stream, watch: ["store:no-such-shop"] },
        { stream, watch: ["user:1"] },
        { stream, watch: Array.from({ length: 21 }, (_, i) => `deal:${i + 1}`) },
      ]) {
        expect((await call("/api/watch", { ...bad, author: amy.as })).status, JSON.stringify(bad).slice(0, 60)).toBe(400);
      }
      expect((await call("/api/watch", { stream, watch: ["store:coles-civic"], author: amy.as })).status).toBe(200);
    } finally {
      page.close();
    }
  });
});

it("/api/here answers anyone with counts only", async () => {
  const res = await fetch(new URL("/api/here", baseUrl));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["deals", "here", "stores"]);
  expect(typeof body.here).toBe("number");
});
