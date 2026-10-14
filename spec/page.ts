import { JSDOM } from "jsdom";
import { baseUrl, type Person } from "./api.ts";

// The real page, app.js in jsdom against the app, with its live stream
// played by the test: it says when the stream opens, fails or closes, and
// delivers events in whatever order the test needs. Not a test file itself.

export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static last: FakeEventSource;
  readyState = FakeEventSource.CONNECTING;
  listeners: Record<string, ((e: any) => void)[]> = {};
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(data: object) {
    for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(data) });
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    for (const fn of this.listeners.open ?? []) fn({});
  }
  // the browser retrying (CONNECTING) or giving up (CLOSED)
  fail(state: number) {
    this.readyState = state;
    for (const fn of this.listeners.error ?? []) fn({});
  }
}

export const until = async (what: string, ok: () => boolean | Promise<boolean>, ms = 5000) => {
  for (const start = Date.now(); !(await ok()); await new Promise((r) => setTimeout(r, 20))) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
  }
};

interface Options {
  path?: string; // the page's address, "/" by default
  // sees each request as it goes and may answer it instead of the app
  network?: (path: string, init: any, res: Response) => Promise<Response>;
}

// as a guest when `as` is undefined
export async function openPage(as: Person | undefined, { path = "/", network }: Options = {}) {
  const url = new URL(path, baseUrl);
  const html = await (await fetch(url)).text();
  const { window } = new JSDOM(html, { url: url.href, runScripts: "outside-only", pretendToBeVisual: true });
  const doc = window.document;

  window.fetch = async (input: string, init: any = {}) => {
    const cookie = as ? { cookie: as.as.cookie } : {};
    const res = await fetch(new URL(input, baseUrl), { ...init, headers: { ...init.headers, ...cookie } });
    return network ? network(new URL(input, baseUrl).pathname, init, res) : res;
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
  // the street map measures its road labels; any length will do here
  Object.assign(window.SVGElement.prototype, { getTotalLength: () => 100 });

  // app.js is a module with top-level await, which a plain eval refuses
  const code = await (await fetch(new URL("/app.js", baseUrl))).text();
  const before = FakeEventSource.last;
  window.eval(`(async () => {\n${code}\n})()`);
  await until("the feed", () => doc.querySelector("#feed")!.getAttribute("aria-busy") === "false");
  await until("the stores", () => doc.querySelectorAll("#post select[name=storeId] option").length > 1);
  if (as) await until("the login", () => !doc.querySelector<HTMLButtonElement>("#logout")!.hidden);
  // this page's stream, not one an earlier page in the same file left behind
  await until("the live stream", () => FakeEventSource.last !== before && !!FakeEventSource.last.listeners.message);
  return { window, doc };
}
