import { describe, expect, it } from "vitest";
import { JPEG, baseUrl, call, person, special, writes } from "./api.ts";
import { watch } from "./stream.ts";

// Live updates: an open page hears about a change without asking. The stream
// carries only ids (and a "notice" for the poster it concerns); a guest may
// listen like anyone else.

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

  it("a guest hears about replies, likes, deleted comments and a photo added or removed", async () => {
    const poster = await person("spec poster");
    const other = await person("spec other");
    const { data: deal } = await call("/api/deals", special(poster));
    const { data: comment } = await call(`/api/deals/${deal.id}/comments`, { body: "still there?", author: poster.as });
    const guest = await watch();
    try {
      const photo = (path: string, body?: BodyInit) =>
        fetch(new URL(path, baseUrl), {
          method: "POST",
          headers: { cookie: poster.as.cookie, ...(body ? { "content-type": "image/jpeg" } : {}) },
          body,
        });
      const changes: [string, () => Promise<number>][] = [
        ["reply", async () => (await call(`/api/deals/${deal.id}/comments`, { body: "yes", replyTo: comment.id, author: other.as })).status],
        ["like", async () => (await call(`/api/comments/${comment.id}/like`, { liked: true, author: other.as })).status],
        ["delete comment", async () => (await call(`/api/comments/${comment.id}/delete`, { author: poster.as })).status],
        ["add photo", async () => (await photo(`/api/deals/${deal.id}/photo`, new Uint8Array(JPEG))).status],
        ["remove photo", async () => (await photo(`/api/deals/${deal.id}/photo/delete`)).status],
      ];
      for (const [what, change] of changes) {
        const before = guest.events.length;
        expect(await change(), what).toBeLessThan(300);
        await guest.until((e) => e.type === "deal" && e.id === deal.id && guest.events.indexOf(e) >= before);
      }
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
