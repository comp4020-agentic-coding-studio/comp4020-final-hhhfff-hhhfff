import { describe, expect, it } from "vitest";
import { call, person, special, writes } from "./api.ts";
import { FakeEventSource, openPage, until } from "./page.ts";
import { watch } from "./stream.ts";

// What the page shows of the live stream: a badge saying whether changes
// arrive as they happen, and how many others have a post or store open. The
// page runs here (the real app.js in jsdom) with its stream played by the
// test. The stream id the test hands it comes from a real stream the test
// holds as the same person, so the page's own /api/watch reaches the app and
// is counted like a browser's.

const here = async () => (await call("/api/here")).data;
const helloFrom = async (page: Awaited<ReturnType<typeof watch>>) =>
  (await page.until((e) => e.type === "hello")).stream as string;

describe("the live badge", () => {
  it("is amber while connecting, green once live, amber while retrying and grey when the browser gives up", async () => {
    const { window, doc } = await openPage(undefined);
    try {
      const badge = doc.querySelector<HTMLElement>("#live")!;
      expect(badge.dataset.state).toBe("connecting");
      FakeEventSource.last.open();
      expect(badge.dataset.state).toBe("on");
      expect(badge.getAttribute("aria-label")).toMatch(/^Live: changes show here as they happen/);
      FakeEventSource.last.fail(FakeEventSource.CONNECTING);
      expect(badge.dataset.state).toBe("connecting");
      FakeEventSource.last.fail(FakeEventSource.CLOSED);
      expect(badge.dataset.state).toBe("off");
      expect(badge.textContent).toBe("Live"); // no count while it isn't live
      expect(badge.getAttribute("aria-label")).toMatch(/^Not live/);
    } finally {
      window.close();
    }
  });
});

describe.skipIf(!writes)("who else is looking, on the page", () => {
  // three rounds of counts, each read after the page's own spread-out delay
  // (up to 1.5 s, so pages don't all ask at once): more than the default 5 s
  it("a card says how many others have it open, not counting me, and the page's stream id goes only to /api/watch", { timeout: 20_000 }, async () => {
    const poster = await person("spec looking poster");
    const [me, amy, ben] = await Promise.all(["spec looking me", "spec looking amy", "spec looking ben"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    const mine = await watch(me.as);
    const others = [await watch(amy.as), await watch(ben.as)];
    const sent: string[] = [];
    let stream = "";
    const { window, doc } = await openPage(me, {
      path: `/deals/${deal.id}`,
      network: async (path, init, res) => {
        if (stream && (path.includes(stream) || String(init.body ?? "").includes(stream))) sent.push(`${init.method} ${path}`);
        return res;
      },
    });
    try {
      stream = await helloFrom(mine);
      FakeEventSource.last.open();
      FakeEventSource.last.emit({ type: "hello", stream });
      await until("the page counted on its post", async () => (await here()).deals[deal.id] === 1);

      for (const [i, page] of others.entries()) {
        await call("/api/watch", { stream: await helloFrom(page), watch: [`deal:${deal.id}`], author: [amy, ben][i].as });
      }
      await until("three on the post", async () => (await here()).deals[deal.id] === 3);
      FakeEventSource.last.emit({ type: "here" });
      const tag = () => doc.querySelector<HTMLElement>(`#deal-${deal.id} .watching`)!;
      await until("the card's count", () => tag().textContent === "👀 2 others looking");
      expect(tag().hidden).toBe(false);
      expect(doc.querySelector("#live")!.textContent).toMatch(/^Live · \d+$/);

      others[1].close(); // ben leaves
      await until("two on the post", async () => (await here()).deals[deal.id] === 2);
      FakeEventSource.last.emit({ type: "here" });
      await until("one other", () => tag().textContent === "👀 1 other looking");
      others[0].close(); // and amy: only me, so the card says nothing
      await until("one on the post", async () => (await here()).deals[deal.id] === 1);
      FakeEventSource.last.emit({ type: "here" });
      await until("the tag hidden", () => tag().hidden === true);

      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((s) => s === "POST /api/watch"), sent.join(", ")).toBe(true);
    } finally {
      window.close();
      [mine, ...others].forEach((p) => p.close());
    }
  });

  it("a store's page says how many others are looking at the store", async () => {
    const store = "all-in-one-dickson";
    const mine = await watch();
    const others = [await watch(), await watch()];
    const { window, doc } = await openPage(undefined, { path: `/stores/${store}` });
    try {
      FakeEventSource.last.open();
      FakeEventSource.last.emit({ type: "hello", stream: await helloFrom(mine) });
      for (const page of others) await call("/api/watch", { stream: await helloFrom(page), watch: [`store:${store}`] });
      await until("three guests on the store", async () => (await here()).stores[store] >= 3);
      FakeEventSource.last.emit({ type: "here" });
      const line = doc.querySelector("#store-here")!;
      await until("the store's count", () => /^👀 \d+ others looking at this store$/.test(line.textContent ?? ""));
    } finally {
      window.close();
      [mine, ...others].forEach((p) => p.close());
    }
  });
});
