import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { baseUrl, call, person, special, uniqueItem, writes, type Person } from "./api.ts";

// New posts by others wait behind a "↑ N new specials" pill; your own post
// is shown at once and never counts as one. The live event for your post can
// reach the page before the server's answer to your post does (they come over
// different connections), so the page runs here, the real app.js in jsdom
// against the app, with the live stream played by the test: it delivers that
// event first, as happens in a browser.

class FakeEventSource {
  static last: FakeEventSource;
  listeners: Record<string, ((e: any) => void)[]> = {};
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {}
  emit(data: object) {
    for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(data) });
  }
}

const until = async (what: string, ok: () => boolean, ms = 5000) => {
  for (const start = Date.now(); !ok(); await new Promise((r) => setTimeout(r, 20))) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
  }
};

async function openPage(as: Person) {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const { window } = new JSDOM(html, { url: baseUrl, runScripts: "outside-only", pretendToBeVisual: true });
  const doc = window.document;

  // the network, as this person; a new post's answer is held back until its
  // live event has been delivered
  window.fetch = async (input: string, init: any = {}) => {
    const res = await fetch(new URL(input, baseUrl), { ...init, headers: { ...init.headers, cookie: as.as.cookie } });
    if (init.method === "POST" && new URL(input, baseUrl).pathname === "/api/deals" && res.status === 201) {
      const text = await res.text();
      FakeEventSource.last.emit({ type: "new", id: JSON.parse(text).id });
      await new Promise((r) => setTimeout(r, 50));
      return new Response(text, { status: res.status, headers: res.headers });
    }
    return res;
  };
  // what jsdom doesn't have; none of it matters here
  Object.assign(window, {
    EventSource: FakeEventSource,
    ResizeObserver: class { observe() {} },
    IntersectionObserver: class { observe() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    scrollTo() {},
  });
  window.Element.prototype.scrollIntoView = () => {};

  // app.js is a module with top-level await, which a plain eval refuses
  const code = await (await fetch(new URL("/app.js", baseUrl))).text();
  window.eval(`(async () => {\n${code}\n})()`);
  await until("the feed", () => doc.querySelector("#feed")!.getAttribute("aria-busy") === "false");
  await until("the stores", () => doc.querySelectorAll("#post select[name=storeId] option").length > 1);
  await until("the login", () => !doc.querySelector<HTMLButtonElement>("#logout")!.hidden);
  return { window, doc };
}

describe.skipIf(!writes)("the new-posts pill", () => {
  it("doesn't count my own post, even when its live event arrives first; it does count someone else's", async () => {
    const me = await person("spec pill poster");
    const { window, doc } = await openPage(me);
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
