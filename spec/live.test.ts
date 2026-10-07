import { describe, expect, it } from "vitest";
import { baseUrl, call, person, special, writes } from "./api.ts";

// Live updates: an open page hears about a change without asking. The stream
// carries only ids (and a "notice" for the poster it concerns); a guest may
// listen like anyone else.

interface Live {
  events: any[];
  until: (match: (e: any) => boolean, ms?: number) => Promise<any>;
  close: () => void;
}

async function watch(as?: { cookie: string }): Promise<Live & { type: string | null }> {
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

describe.skipIf(!writes)("live updates", () => {
  it("a guest listening hears when a special is posted, and about stock, comments, confirmations and delete", async () => {
    const poster = await person("spec poster");
    const other = await person("spec other");
    const guest = await watch();
    try {
      expect(guest.type).toContain("text/event-stream");

      // a new post says so ("new"), so only pages showing page one look again;
      // a change to an existing one is "deal"
      const { data: deal } = await call("/api/deals", special(poster));
      await guest.until((e) => e.type === "new" && e.id === deal.id);

      for (const [path, body] of [
        [`/api/deals/${deal.id}/stock`, { stock: "few" }],
        [`/api/deals/${deal.id}/comments`, { body: "still there" }],
        [`/api/deals/${deal.id}/confirm`, {}],
      ] as const) {
        const before = guest.events.length;
        expect((await call(path, { ...body, author: other.as })).status, path).toBeLessThan(300);
        await guest.until((e) => e.type === "deal" && e.id === deal.id && guest.events.indexOf(e) >= before);
      }

      await call(`/api/deals/${deal.id}/delete`, { author: poster.as });
      await guest.until((e) => e.type === "deleted" && e.id === deal.id);
    } finally {
      guest.close();
    }
  });

  it("only ids go over the stream, never a name, password or token", async () => {
    const poster = await person("spec poster");
    const guest = await watch();
    try {
      const { data: deal } = await call("/api/deals", special(poster));
      await guest.until((e) => e.id === deal.id);
      const text = JSON.stringify(guest.events);
      expect(text).not.toContain(poster.name);
      expect(text).not.toContain(poster.as.cookie.slice(4));
      expect(Object.keys(guest.events.find((e) => e.id === deal.id)).sort()).toEqual(["id", "type"]);
    } finally {
      guest.close();
    }
  });

  it("a poster is told of a correction on their post, and nobody else is", async () => {
    const poster = await person("spec poster");
    const bystander = await person("spec bystander");
    const corrector = await person("spec corrector");
    const { data: deal } = await call("/api/deals", special(poster));
    const [mine, theirs] = [await watch(poster.as), await watch(bystander.as)];
    try {
      await call(`/api/deals/${deal.id}/corrections`, { field: "nowCents", value: 300, author: corrector.as });
      await mine.until((e) => e.type === "notice");
      await theirs.until((e) => e.type === "deal" && e.id === deal.id); // events arrive in order, so a notice would be here
      expect(theirs.events.some((e) => e.type === "notice")).toBe(false);
    } finally {
      mine.close();
      theirs.close();
    }
  });
});
