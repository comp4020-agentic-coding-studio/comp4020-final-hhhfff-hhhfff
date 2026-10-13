import { describe, expect, it } from "vitest";
import { JPEG, baseUrl, call, person, special, writes } from "./api.ts";

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

it("the home page keeps the site's own title and preview", async () => {
  const { html } = await page("/");
  expect(html).toContain("<title>discountShow</title>");
  expect(meta(html, "og:title")).toBe("discountShow");
});
