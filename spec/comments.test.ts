import { describe, expect, inject, it } from "vitest";
import { baseUrl, call, person, special, writes, type Person } from "./api.ts";

// Comments are a conversation on a post: one level of replies (a reply to a
// reply hangs under the same comment and names whom it answers), likes,
// deleting your own (with everything that answers it), and reports. Ten
// different people reporting a comment hides it until an admin restores it,
// which starts the count again, or keeps it hidden.

const comment = async (dealId: number, by: Person, body: string, replyTo?: number) =>
  call(`/api/deals/${dealId}/comments`, { body, replyTo, author: by.as });
const list = async (dealId: number, as?: { cookie: string }) =>
  (await call(`/api/deals/${dealId}/comments`, undefined, as)).data as any[];
const act = (id: number, action: string, body: object, as?: { cookie: string }) =>
  call(`/api/comments/${id}/${action}`, body, as);

describe.skipIf(!writes)("comments", () => {
  it("a reply hangs under the comment it answers; a reply to a reply under the same one, naming whom it answers", async () => {
    const [poster, ann, ben, cat] = await Promise.all(["spec poster", "spec ann", "spec ben", "spec cat"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    const { data: top } = await comment(deal.id, ann, "still on the shelf?");
    const { data: reply } = await comment(deal.id, ben, "yes, three left", top.id);
    const { data: again } = await comment(deal.id, cat, "thanks!", reply.id);
    expect(reply).toMatchObject({ parentId: top.id, replyTo: ann.public });
    expect(again).toMatchObject({ parentId: top.id, replyTo: ben.public });

    // a comment from another post can't be answered here
    const { data: other } = await call("/api/deals", special(poster));
    expect((await comment(other.id, cat, "wrong thread", top.id)).status).toBe(404);
    expect((await call(`/api/deals/${deal.id}/comments`, { body: "hi", replyTo: top.id })).status).toBe(401);

    expect((await list(deal.id)).map((c) => c.id)).toEqual([top.id, reply.id, again.id]);
    expect((await call(`/api/deals/${deal.id}`)).data.comments).toBe(3);
  });

  it("only its writer deletes a comment, and everything answering it goes with it", async () => {
    const [poster, ann, ben] = await Promise.all(["spec poster", "spec ann", "spec ben"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    const { data: top } = await comment(deal.id, ann, "is it the 200g one?");
    const { data: reply } = await comment(deal.id, ben, "yes", top.id);
    const { data: answer } = await comment(deal.id, ann, "great", reply.id);
    const { data: sibling } = await comment(deal.id, poster, "the 400g is dearer", top.id);
    const { data: other } = await comment(deal.id, ben, "seen at 5pm");

    expect((await act(reply.id, "delete", {})).status).toBe(401);
    expect((await act(reply.id, "delete", {}, ann.as)).status).toBe(403);
    expect((await act(reply.id, "delete", {}, ben.as)).status).toBe(200);
    // the reply and the answer to it are gone; the other reply stays
    expect((await list(deal.id)).map((c) => c.id)).toEqual([top.id, sibling.id, other.id]);

    expect((await act(top.id, "delete", {}, ann.as)).status).toBe(200);
    expect((await list(deal.id)).map((c) => c.id)).toEqual([other.id]);
    expect((await call(`/api/deals/${deal.id}`)).data.comments).toBe(1);
    expect((await act(answer.id, "delete", {}, ann.as)).status).toBe(404); // already gone
  });

  it("a like counts once per person, can be taken back, and isn't for your own comment", async () => {
    const [poster, ann, ben] = await Promise.all(["spec poster", "spec ann", "spec ben"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    const { data: c } = await comment(deal.id, ann, "worth it");

    expect((await act(c.id, "like", { liked: true })).status).toBe(401);
    expect((await act(c.id, "like", { liked: true }, ann.as)).status).toBe(400);
    expect((await act(c.id, "like", { liked: "yes" }, ben.as)).status).toBe(400);
    for (let i = 0; i < 2; i++) expect((await act(c.id, "like", { liked: true }, ben.as)).data).toMatchObject({ likes: 1, liked: true });
    expect((await act(c.id, "like", { liked: true }, poster.as)).data).toMatchObject({ likes: 2, liked: true });
    expect((await list(deal.id, ann.as))[0]).toMatchObject({ likes: 2, liked: false });
    expect((await act(c.id, "like", { liked: false }, ben.as)).data).toMatchObject({ likes: 1, liked: false });
  });

  it("ten different people reporting a comment hide it from everyone, even reporting at once; nine don't", async () => {
    const [poster, writer] = await Promise.all(["spec poster", "spec writer"].map(person));
    const reporters = await Promise.all(Array.from({ length: 10 }, (_, i) => person(`spec reporter ${i}`)));
    const { data: deal } = await call("/api/deals", special(poster));
    const { data: c } = await comment(deal.id, writer, "rude words here");

    expect((await act(c.id, "report", {}, writer.as)).status).toBe(400); // not your own
    expect((await act(c.id, "report", {})).status).toBe(401);
    for (const r of reporters.slice(0, 9)) expect((await act(c.id, "report", {}, r.as)).status).toBe(201);
    expect((await act(c.id, "report", {}, reporters[0].as)).status).toBe(200); // a second report doesn't count
    expect((await list(deal.id))[0]).toMatchObject({ hidden: null, body: "rude words here" });

    expect((await act(c.id, "report", {}, reporters[9].as)).data).toMatchObject({ hidden: "reported", body: null, reported: true });
    for (const as of [undefined, poster.as, writer.as]) {
      const [seen] = await list(deal.id, as);
      expect(seen).toMatchObject({ id: c.id, hidden: "reported", body: null });
      expect(seen).not.toHaveProperty("reports");
    }
    expect(JSON.stringify((await call(`/api/deals/${deal.id}`)).data)).not.toContain("rude words");

    // reports arriving together still hide it exactly once
    const { data: c2 } = await comment(deal.id, writer, "more rude words");
    await Promise.all(reporters.map((r) => act(c2.id, "report", {}, r.as)));
    expect((await list(deal.id)).find((x) => x.id === c2.id)).toMatchObject({ hidden: "reported", body: null });
  });

  it("only an admin reviews a hidden comment", async () => {
    const [poster, ann] = await Promise.all(["spec poster", "spec ann"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    const { data: c } = await comment(deal.id, ann, "fine comment");
    expect((await act(c.id, "review", { decision: "restore" }, poster.as)).status).toBe(403);
    expect((await act(c.id, "review", { decision: "restore" })).status).toBe(401);
  });

  // Needs an app started with this name in ADMIN_USERS (see accounts.test.ts).
  const adminName = inject("adminUser");
  it.skipIf(!adminName)("an admin is told once, sees it, and restores it (the count starts again) or keeps it hidden", async () => {
    const admin = await adminSession(adminName);

    const [poster, writer] = await Promise.all(["spec poster", "spec writer"].map(person));
    const reporters = await Promise.all(Array.from({ length: 12 }, (_, i) => person(`spec reporter ${i}`)));
    const { data: deal } = await call("/api/deals", special(poster));
    const { data: c } = await comment(deal.id, writer, "borderline joke");
    await Promise.all(reporters.slice(0, 10).map((r) => act(c.id, "report", {}, r.as)));

    const notes = (await call("/api/notifications", {}, admin)).data.filter((n: any) => n.commentId === c.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ dealId: deal.id, text: expect.stringContaining("borderline joke") });
    expect((await list(deal.id, admin))[0]).toMatchObject({ hidden: "reported", body: "borderline joke", reports: 10 });

    // restored: shown again, and the old reporters can't bring it back down
    expect((await act(c.id, "review", { decision: "restore" }, admin)).data).toMatchObject({ hidden: null, reports: 0 });
    expect((await list(deal.id))[0]).toMatchObject({ hidden: null, body: "borderline joke" });
    expect((await act(c.id, "review", { decision: "restore" }, admin)).status).toBe(409);
    for (const r of reporters.slice(0, 10)) expect((await act(c.id, "report", {}, r.as)).status).toBe(200);
    expect((await act(c.id, "report", {}, reporters[10].as)).data).toMatchObject({ hidden: null });

    // kept hidden: stays hidden from everyone else
    const { data: c2 } = await comment(deal.id, writer, "worse joke");
    await Promise.all(reporters.slice(0, 10).map((r) => act(c2.id, "report", {}, r.as)));
    expect((await act(c2.id, "review", { decision: "keep" }, admin)).data).toMatchObject({ hidden: "kept", body: "worse joke" });
    expect((await list(deal.id)).find((x) => x.id === c2.id)).toMatchObject({ hidden: "kept", body: null });

    // and an admin can delete anyone's comment
    expect((await act(c2.id, "delete", {}, admin)).status).toBe(200);
  });

  it("reports wait in an admin-only inbox, hidden ones first, until an admin restores, hides or deletes them", async () => {
    const [poster, writer, plainUser] = await Promise.all(["spec poster", "spec writer", "spec user"].map(person));
    expect((await call("/api/reports")).status).toBe(401);
    expect((await call("/api/reports", undefined, plainUser.as)).status).toBe(403);
    if (!adminName) return; // the rest needs an admin (see accounts.test.ts)
    const admin = await adminSession(adminName);

    const reporters = await Promise.all(Array.from({ length: 10 }, (_, i) => person(`spec reporter ${i}`)));
    const { data: deal } = await call("/api/deals", special(poster));
    const [one, two, many] = await Promise.all(["one report", "two reports", "ten reports"].map(
      async (body) => (await comment(deal.id, writer, body)).data,
    ));
    await act(one.id, "report", {}, reporters[0].as);
    await Promise.all(reporters.slice(0, 2).map((r) => act(two.id, "report", {}, r.as)));
    await Promise.all(reporters.map((r) => act(many.id, "report", {}, r.as)));

    const inbox = async () =>
      ((await call("/api/reports", undefined, admin)).data as any[]).filter((x) => x.deal.id === deal.id);
    expect((await inbox()).map((x) => [x.comment.body, x.comment.reports, x.comment.hidden])).toEqual([
      ["ten reports", 10, "reported"],
      ["two reports", 2, null],
      ["one report", 1, null],
    ]);
    expect((await inbox())[0].deal).toMatchObject({ id: deal.id, item: deal.item, storeId: deal.storeId });

    // each way of dealing with one takes it out of the inbox
    expect((await act(many.id, "review", { decision: "restore" }, admin)).data).toMatchObject({ hidden: null });
    expect((await act(two.id, "review", { decision: "keep" }, admin)).data).toMatchObject({ hidden: "kept" });
    expect((await list(deal.id)).find((x) => x.id === two.id)).toMatchObject({ body: null }); // hidden before ten
    expect((await act(one.id, "delete", {}, admin)).status).toBe(200);
    expect(await inbox()).toEqual([]);
    expect((await act(two.id, "review", { decision: "keep" }, admin)).status).toBe(409);
  });
});

async function adminSession(name: string): Promise<{ cookie: string }> {
  const enter = (path: string) => fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: name, password: "spec-password-1" }),
  });
  let res = await enter("/api/register");
  if (res.status !== 201) res = await enter("/api/login");
  expect(await res.json()).toMatchObject({ role: "admin" });
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}
