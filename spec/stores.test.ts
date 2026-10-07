import { expect, it } from "vitest";
import { call, person, special, wholeFeed, writes } from "./api.ts";

// The store list carries how many specials are live at each store, for the
// page's map: a new post counts, a sold-out one doesn't. No other spec posts
// at this store, so its count is this test's alone.
const STORE = "abuy-dickson";
const liveAt = async () => (await call("/api/stores")).data.find((s: any) => s.id === STORE).live;

it.runIf(writes)("each store counts its live specials, leaving out sold-out ones", async () => {
  const before = await liveAt();
  const notSoldOut = (await wholeFeed(`/api/deals?store=${STORE}`)).filter((d) => d.stock !== "gone");
  expect(before).toBe(notSoldOut.length);

  const poster = await person("Map poster");
  const { status, data: deal } = await call("/api/deals", special(poster, { storeId: STORE }));
  expect(status).toBe(201);
  expect(await liveAt()).toBe(before + 1);

  const passerby = await person("Map passerby");
  expect((await call(`/api/deals/${deal.id}/stock`, { stock: "gone", author: passerby.as })).status).toBe(200);
  expect(await liveAt()).toBe(before);
});

it("store counts are numbers for every store, and the list says nothing about who posted", async () => {
  const { status, data } = await call("/api/stores");
  expect(status).toBe(200);
  for (const s of data) {
    expect(Object.keys(s).sort()).toEqual(["id", "kind", "lat", "live", "lon", "name", "where"]);
    expect(Number.isInteger(s.live) && s.live >= 0).toBe(true);
  }
});
