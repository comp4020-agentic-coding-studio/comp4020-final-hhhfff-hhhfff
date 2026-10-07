import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

// The page points at the big chains' own specials pages: beside the feed when
// there are posts, in the middle under an empty-feed note when there are none.
// They are links only: nothing is fetched from those sites (the README rules
// out scraping), they open off-site without handing it this page, and they
// come after the feed, since specials posted here come first.
const baseUrl = inject("baseUrl");

const CHAINS = [
  "www.coles.com.au",
  "www.aldi.com.au",
  "www.iga.com.au",
  "www.woolworths.com.au",
  "www.supabarn.com.au",
  "www.costco.com.au",
];

async function page() {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  return new JSDOM(html).window.document;
}

it("the page links to each chain's own specials pages, after the feed", async () => {
  const document = await page();
  const chains = document.querySelector("#chains");
  const feed = document.querySelector("#feed");
  expect(chains, "no #chains section on /").not.toBeNull();
  expect(feed!.compareDocumentPosition(chains!) & 4, "#chains must come after #feed").toBeTruthy();

  const links = [...chains!.querySelectorAll("a")];
  expect([...new Set(links.map((a) => new URL(a.href).hostname))]).toEqual(CHAINS);
  for (const a of links) {
    expect(new URL(a.href).protocol).toBe("https:");
    expect(a.target).toBe("_blank");
    expect(a.rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  }
});

it("an empty feed says nothing is shared yet and offers to post the first", async () => {
  const document = await page();
  const empty = document.querySelector("#chains-empty");
  expect(empty, "no empty-feed note inside #chains").not.toBeNull();
  expect(empty!.textContent).toMatch(/No one has shared a special yet/);
  expect(empty!.querySelector("button#post-first")).not.toBeNull();
});
