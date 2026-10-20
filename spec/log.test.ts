import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type App, launch } from "./launch.ts";

// The action log is how the owner tells people apart from the server's side
// alone (`flyctl logs`, read during the crit while classmates use the app):
// each change someone asks for is one JSON line on stdout naming the account
// the session cookie belongs to, what they did, to which post or comment and
// whose, and how the server answered, refusals included. It never holds a
// password, a session token or what someone wrote. The shared running app's
// output isn't visible to a test, so this starts its own, on a throwaway data
// directory, and reads what it prints.

const dataDir = mkdtempSync(join(tmpdir(), "spec-log-"));
const ADMIN = "log-admin";
const PASSWORD = "spec-password-1";
let app: App;

beforeAll(async () => {
  app = await launch({ DATA_DIR: dataDir, ADMIN_USERS: ADMIN }, { stdout: true });
});

afterAll(async () => {
  await app?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

async function post(path: string, body: unknown, cookie = "") {
  const res = await fetch(app.url + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json(), cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

const register = async (username: string) => {
  const r = await post("/api/register", { username, password: PASSWORD });
  expect(r.status).toBe(201);
  return r.cookie;
};

const actions = (): Record<string, unknown>[] =>
  app
    .stdout()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l))
    .filter((l) => l.log === "action");

// The line is written once the answer has gone, so it can land just after the
// response does: wait for it rather than read once.
async function logged(match: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let i = 0; i < 50; i++) {
    const found = actions().find((l) => Object.entries(match).every(([k, v]) => l[k] === v));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no action logged like ${JSON.stringify(match)}; the log has:\n${app.stdout()}`);
}

const special = (item: string) => ({
  storeId: "coles-civic",
  item,
  wasCents: 500,
  nowCents: 250,
  endsOn: null,
  stock: "plenty",
  source: "in-store",
});

describe("the action log", { timeout: 60_000 }, () => {
  it("tells two people apart: each line names the account behind the cookie", async () => {
    const ann = await register("log-ann");
    const ben = await register("log-ben");
    await logged({ did: "register", user: "log-ann", status: 201 });
    await logged({ did: "register", user: "log-ben", status: 201 });

    const deal = await post("/api/deals", special("Log test noodles"), ann);
    expect(deal.status).toBe(201);
    const id = deal.data.id;
    expect(await logged({ did: "post", deal: id })).toMatchObject({
      user: "log-ann",
      role: "user",
      store: "coles-civic",
      item: "Log test noodles",
      status: 201,
    });

    await post(`/api/deals/${id}/stock`, { stock: "few" }, ben);
    expect(await logged({ did: "report stock", deal: id })).toMatchObject({
      user: "log-ben",
      owner: "log-ann",
      stock: "few",
      status: 200,
    });

    await post(`/api/deals/${id}/confirm`, {}, ben);
    expect(await logged({ did: "confirm", deal: id })).toMatchObject({ user: "log-ben", owner: "log-ann", status: 201 });

    await post(`/api/deals/${id}/corrections`, { field: "nowCents", value: 240 }, ben);
    expect(await logged({ did: "correct", deal: id, user: "log-ben" })).toMatchObject({
      owner: "log-ann",
      field: "nowCents",
      value: 240,
      applied: false,
      status: 201,
    });
  });

  it("logs a refused change with who tried, whose it was and why it was refused", async () => {
    const owner = await register("log-owner");
    const other = await register("log-other");
    const { data: deal } = await post("/api/deals", special("Log test dumplings"), owner);

    expect((await post(`/api/deals/${deal.id}/delete`, {}, other)).status).toBe(403);
    expect(await logged({ did: "delete post", deal: deal.id, status: 403 })).toMatchObject({
      user: "log-other",
      owner: "log-owner",
      error: "only the person who posted this can delete it",
    });

    // a guest has no account, and the line says so
    expect((await post(`/api/deals/${deal.id}/stock`, { stock: "gone" })).status).toBe(401);
    expect(await logged({ did: "report stock", deal: deal.id, status: 401 })).toMatchObject({ user: null, role: "guest" });

    // an admin may take anyone's post down, and the line shows it was an admin
    const admin = await register(ADMIN);
    expect((await post(`/api/deals/${deal.id}/delete`, {}, admin)).status).toBe(200);
    expect(await logged({ did: "delete post", deal: deal.id, status: 200 })).toMatchObject({
      user: ADMIN,
      role: "admin",
      owner: "log-owner",
    });
  });

  it("names who logged in and out, but not a name that isn't an account", async () => {
    await register("log-cat");
    const login = await post("/api/login", { username: "log-cat", password: PASSWORD });
    expect(await logged({ did: "login", status: 200 })).toMatchObject({ user: "log-cat", role: "user" });

    await post("/api/login", { username: "log-cat", password: "wrong-password-9" });
    expect(await logged({ did: "login", status: 401, as: "log-cat" })).toMatchObject({ user: null });

    // what someone typed as a username may be their password in the wrong box
    await post("/api/login", { username: "notanaccount-123", password: PASSWORD });
    await logged({ did: "login", status: 401, user: null });
    expect(app.stdout()).not.toContain("notanaccount-123");

    await post("/api/logout", {}, login.cookie);
    expect(await logged({ did: "logout" })).toMatchObject({ user: "log-cat", status: 200 });
  });

  it("never holds a password, a session token or what someone wrote", async () => {
    const dan = await register("log-dan");
    const eve = await register("log-eve");
    const { data: deal } = await post("/api/deals", special("Log test tofu"), dan);
    const words = "meet me at the back door, my number is 0400 000 000";
    const comment = await post(`/api/deals/${deal.id}/comments`, { body: words }, eve);
    expect(await logged({ did: "comment", deal: deal.id })).toMatchObject({
      user: "log-eve",
      owner: "log-dan",
      comment: comment.data.id,
    });
    const note = "the shelf tag says something else entirely";
    await post(`/api/deals/${deal.id}/corrections`, { field: "item", value: "Log test silken tofu", note }, eve);
    await logged({ did: "correct", deal: deal.id, user: "log-eve" });

    const out = app.stdout();
    expect(out).not.toContain(PASSWORD);
    expect(out).not.toContain(words);
    expect(out).not.toContain(note);
    for (const cookie of [dan, eve]) expect(out).not.toContain(cookie.split("=")[1]);
  });
});
