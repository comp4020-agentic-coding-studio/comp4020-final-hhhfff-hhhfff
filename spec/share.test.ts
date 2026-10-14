import { describe, expect, it } from "vitest";
import { JPEG, baseUrl, call, person, special, writes } from "./api.ts";
import { openPage } from "./page.ts";

// A post has its own address, /deals/<id>, so it can be passed on in a chat
// the way friends already pass on cheap food. The page there is the app's
// page with that post's title and link preview filled in on the server, so
// a chat app that doesn't run scripts still shows what the special is.

const page = async (path: string) => {
  const res = await fetch(new URL(path, baseUrl));
  return { status: res.status, type: res.headers.get("content-type"), html: await res.text() };
};
const meta = (html: string, property: string) =>
  html.match(new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`))?.[1];

describe.skipIf(!writes)("a post's own page", () => {
  // The store pages (398d7af) un-hid these on every page but /stores, this
  // one included, after the post's own layout (398893a) had hidden them.
  it("shows the post alone: no search row, map, post button, pages or chains around it", async () => {
    const poster = await person("spec share");
    const { data: deal } = await call("/api/deals", special(poster));
    for (const as of [undefined, poster]) {
      const { window, doc } = await openPage(as, { path: `/deals/${deal.id}` });
      try {
        const who = as ? "signed in" : "guest";
        expect(doc.querySelector<HTMLElement>("#single-head")!.hidden, who).toBe(false);
        expect(doc.querySelectorAll("#feed .deal").length, who).toBe(1);
        for (const sel of [".filters", "#filters-top", "#store-map", "#post-toggle", "#chains", "#pager"]) {
          expect(doc.querySelector<HTMLElement>(sel)!.hidden, `${who}: ${sel}`).toBe(true);
        }
      } finally {
        window.close();
      }
    }
  });

  it("serves the app with the post's title, price, store and stock in the link preview", async () => {
    const poster = await person("spec share");
    const { data: deal } = await call("/api/deals", special(poster, { wasCents: 400, nowCents: 300, stock: "few" }));
    const { status, type, html } = await page(`/deals/${deal.id}`);
    expect(status).toBe(200);
    expect(type).toContain("text/html");
    expect(html).toContain('src="/app.js"');
    expect(html).toContain(`<title>${deal.item} $3.00 (was $4.00) · Coles</title>`);
    expect(meta(html, "og:title")).toBe(`${deal.item} $3.00 (was $4.00) · Coles`);
    expect(meta(html, "og:description")).toMatch(/^25% off at Coles, Bunda St, Civic\. Only a few left/);
    expect(meta(html, "og:image")).toBeUndefined();
  });

  it("previews the shelf photo once there is one", async () => {
    const poster = await person("spec share photo");
    const { data: deal } = await call("/api/deals", special(poster));
    await fetch(new URL(`/api/deals/${deal.id}/photo`, baseUrl), {
      method: "POST",
      headers: { "content-type": "image/jpeg", cookie: poster.as.cookie },
      body: new Uint8Array(JPEG),
    });
    const image = meta((await page(`/deals/${deal.id}`)).html, "og:image");
    expect(image).toMatch(new RegExp(`^http://[^/]+/api/deals/${deal.id}/photo\\?v=`));
    expect((await fetch(image!)).headers.get("content-type")).toBe("image/jpeg");
  });

  it("escapes what the poster typed, so an item name can't add markup", async () => {
    const poster = await person("spec share xss");
    const item = `Choc "bar" <script>alert(1)</script> ${crypto.randomUUID().slice(0, 6)}`;
    const { data: deal } = await call("/api/deals", special(poster, { item }));
    const { html } = await page(`/deals/${deal.id}`);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Choc &quot;bar&quot; &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("says a deleted or unknown post isn't there, and reveals nothing of it", async () => {
    const poster = await person("spec share gone");
    const { data: deal } = await call("/api/deals", special(poster));
    await call(`/api/deals/${deal.id}/delete`, { author: poster.as });
    for (const path of [`/deals/${deal.id}`, "/deals/999999999"]) {
      const { status, html } = await page(path);
      expect(status, path).toBe(200);
      expect(meta(html, "og:title"), path).toBe("Special not found · discountShow");
      expect(html, path).not.toContain(deal.item);
    }
  });
});

describe("stores' own pages", () => {
  it("a store's page is titled with its name and says how many specials are live there", async () => {
    const { status, html } = await page("/stores/coles-civic");
    expect(status).toBe(200);
    expect(html).toContain('src="/app.js"');
    expect(html).toContain("<title>Coles, Bunda St, Civic · discountShow</title>");
    expect(meta(html, "og:description")).toMatch(/^(No specials|1 special|\d+ specials) live at Coles, Bunda St, Civic/);
  });

  it.skipIf(!writes)("counts a new special in the store's preview", async () => {
    const before = meta((await page("/stores/iga-ainslie")).html, "og:description")!;
    const count = (s: string) => (s.startsWith("No") ? 0 : Number.parseInt(s, 10));
    const poster = await person("spec store page");
    await call("/api/deals", special(poster, { storeId: "iga-ainslie" }));
    const after = meta((await page("/stores/iga-ainslie")).html, "og:description")!;
    expect(count(after)).toBe(count(before) + 1);
  });

  it("lists every store at /stores, and an unknown store's page says so", async () => {
    expect((await page("/stores")).html).toContain("<title>Stores near ANU · discountShow</title>");
    const { status, html } = await page("/stores/no-such-shop");
    expect(status).toBe(200);
    expect(meta(html, "og:title")).toBe("Store not found · discountShow");
  });

  it("/about leads to the README", async () => {
    const res = await fetch(new URL("/about", baseUrl), { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/readme/");
  });
});

it("the home page keeps the site's own title and preview", async () => {
  const { html } = await page("/");
  expect(html).toContain("<title>discountShow</title>");
  expect(meta(html, "og:title")).toBe("discountShow");
});
