import { describe, expect, it } from "vitest";
import { call, person, special, uniqueItem, writes } from "./api.ts";
import { FakeEventSource, openPage, until } from "./page.ts";

// New posts by others wait behind a "↑ N new specials" pill; your own post
// is shown at once and never counts as one. The live event for your post can
// reach the page before the server's answer to your post does (they come over
// different connections), so the page runs here, the real app.js in jsdom
// against the app, with the live stream played by the test: it delivers that
// event first, as happens in a browser.

describe.skipIf(!writes)("the new-posts pill", () => {
  it("doesn't count my own post, even when its live event arrives first; it does count someone else's", async () => {
    const me = await person("spec pill poster");
    // a new post's answer is held back until its live event has been delivered
    const { window, doc } = await openPage(me, {
      network: async (path, init, res) => {
        if (init.method !== "POST" || path !== "/api/deals" || res.status !== 201) return res;
        const text = await res.text();
        FakeEventSource.last.emit({ type: "new", id: JSON.parse(text).id });
        await new Promise((r) => setTimeout(r, 50));
        return new Response(text, { status: res.status, headers: res.headers });
      },
    });
    try {
      const pill = doc.querySelector<HTMLButtonElement>("#new-posts")!;
      const form = doc.querySelector<HTMLFormElement>("#post")!;
      const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
      field("storeId").value = "coles-civic";
      field("product").value = uniqueItem("spec pill");
      field("was").value = "5.50";
      field("now").value = "2.75";
      form.dispatchEvent(new window.Event("submit", { cancelable: true }));

      await until("my post on the page", () => !!doc.querySelector("#feed .item")?.textContent?.startsWith("spec pill"));
      expect(pill.hidden, `pill shows "${pill.textContent}" for my own post`).toBe(true);

      const other = await person("spec pill other");
      const { data: theirs } = await call("/api/deals", special(other));
      FakeEventSource.last.emit({ type: "new", id: theirs.id });
      expect(pill.hidden).toBe(false);
      expect(pill.textContent).toContain("1 new special");
    } finally {
      window.close();
    }
  });
});
