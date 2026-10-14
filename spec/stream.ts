import { baseUrl } from "./api.ts";

// An open page's live stream (/api/events), read as the page reads it: each
// "data:" frame parsed into events, in order. Not a test file itself.

export interface Live {
  events: any[];
  until: (match: (e: any) => boolean, ms?: number) => Promise<any>;
  close: () => void;
}

export async function watch(as?: { cookie: string }): Promise<Live & { type: string | null }> {
  const abort = new AbortController();
  const res = await fetch(new URL("/api/events", baseUrl), {
    headers: as ? { cookie: as.cookie } : {},
    signal: abort.signal,
  });
  const events: any[] = [];
  (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const line = buffer.slice(0, end).split("\n").find((l) => l.startsWith("data: "));
          buffer = buffer.slice(end + 2);
          if (line) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {
      // closed by the test
    }
  })();
  return {
    type: res.headers.get("content-type"),
    events,
    close: () => abort.abort(),
    until: async (match, ms = 5000) => {
      for (const start = Date.now(); Date.now() - start < ms; await new Promise((r) => setTimeout(r, 20))) {
        const hit = events.find(match);
        if (hit) return hit;
      }
      throw new Error(`no matching event in ${ms}ms; got ${JSON.stringify(events)}`);
    },
  };
}
