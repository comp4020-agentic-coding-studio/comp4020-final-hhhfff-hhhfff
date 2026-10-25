import { inject } from "vitest";

// Loaded before every spec file (vitest.config.ts's setupFiles). When the run
// may not write (APP_URL names a real site, see `writes` in api.ts), any POST
// to that app throws here instead of reaching it. The `writes` flag alone once
// let a skipped describe's setup post 18 specials to the live feed on
// 2026-10-25, because vitest runs a skipped block's body while collecting it.
// This catches the next such slip as a failure, not as data in the feed.
// Not a test file itself.

const baseUrl = inject("baseUrl");
const allowed =
  ["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname) || process.env.SPEC_WRITES === "1";

if (!allowed) {
  const origin = new URL(baseUrl).origin;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin === origin && method !== "GET" && method !== "HEAD") {
      throw new Error(`refusing ${method} ${url.pathname}: this run may not write to ${origin}; put the write inside a test gated by \`writes\``);
    }
    return realFetch(input, init);
  };
}
