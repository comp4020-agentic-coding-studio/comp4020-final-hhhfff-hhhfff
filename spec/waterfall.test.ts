import { describe, expect, it } from "vitest";
import { call, person, special, writes } from "./api.ts";
import { FakeEventSource, openPage, until } from "./page.ts";

// In two or three columns the feed is a waterfall: each card goes under the
// shortest column at its own height, so opening one card's comments pushes
// down only the cards under it. It once lined cards up in rows instead, and
// opening one card stretched every card beside it. A card keeps its column
// while it stays on the page, so nothing jumps sideways under the reader.
//
// The page runs here (the real app.js in jsdom), which lays nothing out: the
// test says how many columns there are and how tall each card is, tells the
// page when one changed size, and reads where the page put each card. How it
// looks is checked in a browser.

const ROW = 2; // the waterfall's rows, in px (grid-auto-rows in styles.css)
const GAP = 12; // between cards, in px

describe.skipIf(!writes)("the feed as a waterfall", () => {
  it("puts each card under the shortest column, keeps it there as it grows, and tops the shortest with a new one", async () => {
    const poster = await person("spec waterfall");
    // a made-up word in every item keeps other spec files' posts off the page
    const tag = `wf${crypto.randomUUID().replace(/[^a-f]/g, "").slice(0, 8)}x`;
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push((await call("/api/deals", special(poster, { item: `Waterfall ${i} ${tag}` }))).data.id);
    const [a, b, c, d] = [...ids].reverse(); // newest first, as the feed shows them

    const tall = new Map([[a, 300], [b, 200], [c, 220], [d, 180]].map(([id, px]) => [String(id), px]));
    const { window, doc, resized } = await openPage(undefined, { path: `/?q=${tag}` });
    try {
      // two columns, as on a tablet, with cards as tall as `tall` says
      const style = doc.createElement("style");
      style.textContent = `#feed { --lanes: 2; column-gap: ${GAP}px; } #feed.waterfall { grid-auto-rows: ${ROW}px; }`;
      doc.head.append(style);
      Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
          return tall.get(this.dataset.id ?? "") ?? 0;
        },
      });
      const feed = doc.querySelector<HTMLElement>("#feed")!;
      const card = (id: number) => doc.querySelector<HTMLElement>(`#deal-${id}`)!;
      const lane = (id: number) => card(id).style.getPropertyValue("--lane");
      const rows = (id: number) => card(id).style.getPropertyValue("--rows");
      const rowsFor = (px: number) => String(Math.ceil((px + GAP) / ROW));
      resized(card(a)); // the page had one column when it drew the feed

      expect(feed.classList.contains("waterfall")).toBe(true);
      // a, the newest, goes left, b right, c under b (the shorter), d under a
      expect([a, b, c, d].map(lane)).toEqual(["1", "2", "2", "1"]);
      expect([a, b, c, d].map(rows)).toEqual([300, 200, 220, 180].map(rowsFor));
      // the cards stay in the feed's order, for a keyboard or screen reader
      expect([...feed.children].map((li) => Number((li as HTMLElement).dataset.id))).toEqual([a, b, c, d]);

      // b opens its comments: only b grows, and every card keeps its column,
      // though the left one is now the shorter
      tall.set(String(b), 700);
      resized(card(b));
      expect(rows(b)).toBe(rowsFor(700));
      expect([a, c, d].map(rows)).toEqual([300, 220, 180].map(rowsFor));
      expect([a, b, c, d].map(lane)).toEqual(["1", "2", "2", "1"]);

      // someone posts, and the reader brings it in with the new-posts pill:
      // it goes to the shorter column, and the cards already there stay put
      const { data: e } = await call("/api/deals", special(poster, { item: `Waterfall 4 ${tag}` }));
      tall.set(String(e.id), 250);
      FakeEventSource.last.emit({ type: "new", id: e.id });
      doc.querySelector<HTMLButtonElement>("#new-posts")!.click();
      await until("the new post on the page", () => !!doc.querySelector(`#deal-${e.id}`));
      expect(feed.firstElementChild).toBe(card(e.id));
      expect(lane(e.id)).toBe("1");
      expect([a, b, c, d].map(lane)).toEqual(["1", "2", "2", "1"]);

      // a phone's single column is a plain list
      style.textContent = "#feed { --lanes: 1; }";
      resized(card(a));
      expect(feed.classList.contains("waterfall")).toBe(false);
    } finally {
      window.close();
    }
  });
});
