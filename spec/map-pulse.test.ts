import { describe, expect, it } from "vitest";
import { call, person, special, writes } from "./api.ts";
import { FakeEventSource, openPage, until } from "./page.ts";

// The store map shows where things are happening: when a live event brings
// news of a post or a stock report, that store's dot sends out a ring, and a
// store left with fewer live specials shrinks to its new size. The page runs
// here (the real app.js in jsdom) with its stream played by the test; jsdom
// doesn't animate, so this checks the ring and the shrink are put there, and
// the movement was looked at in Chrome.

describe.skipIf(!writes)("map pulses", () => {
  it("a new post or a stock report pulses its store's dot; sold out shrinks it; other stores stay still", { timeout: 20_000 }, async () => {
    const store = "iga-oconnor"; // no other spec posts here
    const atStart = new Map((await call("/api/stores")).data.map((s: any) => [s.id, `${s.lastReportAt}|${s.live}`]));
    const { window, doc } = await openPage(undefined);
    try {
      const dot = () => doc.querySelector<SVGGElement>(`#map-svg .map-store[data-store="${store}"]`)!;
      await until("the map's dots", () => !!dot());
      const pulsing = () =>
        [...doc.querySelectorAll<SVGGElement>("#map-svg .map-store")].filter((g) => g.querySelector(".map-pulse")).map((g) => g.dataset.store);
      // other spec files post, report and delete at their own stores meanwhile,
      // and those rightly ripple or shrink too; a store with neither a new
      // report nor a changed count since before the page loaded must not
      const reports = async () => new Map((await call("/api/stores")).data.map((s: any) => [s.id, `${s.lastReportAt}|${s.live}`]));
      const quiet = async () => {
        const now = await reports();
        return [...now.keys()].filter((id) => now.get(id) === atStart.get(id));
      };
      FakeEventSource.last.open();

      const poster = await person("spec pulse poster");
      const { data: deal } = await call("/api/deals", special(poster, { storeId: store }));
      FakeEventSource.last.emit({ type: "new", id: deal.id });
      await until("a ring on the store's dot", () => !!dot().querySelector(".map-pulse"));
      const stillStores = await quiet();
      expect(stillStores.length).toBeGreaterThan(5);
      expect(pulsing().filter((id) => stillStores.includes(id!))).toEqual([]);
      expect(dot().classList.contains("shrinking")).toBe(false);
      dot().querySelector(".map-pulse")!.dispatchEvent(new window.Event("animationend"));
      expect(dot().querySelector(".map-pulse")).toBeNull();

      const passerby = await person("spec pulse passerby");
      await call(`/api/deals/${deal.id}/stock`, { stock: "few", author: passerby.as });
      FakeEventSource.last.emit({ type: "deal", id: deal.id });
      await until("a ring for the stock report", () => !!dot().querySelector(".map-pulse"));
      expect(dot().classList.contains("shrinking")).toBe(false);
      dot().querySelector(".map-pulse")!.dispatchEvent(new window.Event("animationend"));

      const another = await person("spec pulse gone");
      await call(`/api/deals/${deal.id}/stock`, { stock: "gone", author: another.as });
      FakeEventSource.last.emit({ type: "deal", id: deal.id });
      await until("the dot shrinking", () => dot().classList.contains("shrinking"));
      const circle = dot().querySelector<SVGCircleElement>("circle:not(.map-pulse)")!;
      expect(Number(circle.style.getPropertyValue("--was"))).toBeGreaterThan(1); // it starts bigger than it ends

      // a comment changes nothing on the map
      dot().querySelector(".map-pulse")?.dispatchEvent(new window.Event("animationend"));
      await call(`/api/deals/${deal.id}/comments`, { body: "still there?", author: passerby.as });
      FakeEventSource.last.emit({ type: "deal", id: deal.id });
      await new Promise((r) => setTimeout(r, 1500));
      expect(pulsing()).not.toContain(store);

      // a deleted special shrinks its store too
      const { data: second } = await call("/api/deals", special(poster, { storeId: store }));
      FakeEventSource.last.emit({ type: "new", id: second.id });
      await until("a ring for the second post", () => !!dot().querySelector(".map-pulse"));
      dot().querySelector(".map-pulse")!.dispatchEvent(new window.Event("animationend"));
      expect((await call(`/api/deals/${second.id}/delete`, { author: poster.as })).status).toBe(200);
      FakeEventSource.last.emit({ type: "deleted", id: second.id });
      await until("the dot shrinking after a delete", () => dot().classList.contains("shrinking"));
    } finally {
      window.close();
    }
  });
});
