import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

// The store map draws real streets from public/streets.json, built once from
// OpenStreetMap by scripts/streets.ts: the app serves it like any page file
// and asks no map service at runtime. OpenStreetMap's licence wants credit,
// so the page links to its copyright page.
const baseUrl = inject("baseUrl");

it("the street map is served as data the page can draw, in the stores' own projection", async () => {
  const res = await fetch(new URL("/streets.json", baseUrl));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const map = await res.json();
  expect(map.attribution).toMatch(/OpenStreetMap/);
  for (const layer of ["water", "green", "buildings", "major", "mid", "minor"]) {
    expect(map.layers[layer], layer).toMatch(/^M-?\d/);
  }
  // every store falls inside the area drawn
  const stores = (await (await fetch(new URL("/api/stores", baseUrl))).json()) as { lat: number; lon: number }[];
  for (const s of stores) {
    expect(s.lat).toBeGreaterThan(map.box.south);
    expect(s.lat).toBeLessThan(map.box.north);
    expect(s.lon).toBeGreaterThan(map.box.west);
    expect(s.lon).toBeLessThan(map.box.east);
  }
});

it("the page credits OpenStreetMap beside the map, opening off-site safely", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const document = new JSDOM(html).window.document;
  const credit = document.querySelector('#store-map a[href="https://www.openstreetmap.org/copyright"]');
  expect(credit, "no OpenStreetMap credit in #store-map").not.toBeNull();
  expect(credit!.getAttribute("target")).toBe("_blank");
  expect(credit!.getAttribute("rel")!.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
});
