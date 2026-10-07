import { describe, expect, inject, it } from "vitest";
import { baseUrl, call, person, special, writes } from "./api.ts";

// Accounts and roles. A guest (no session) can only read; a signed-in user can
// post, confirm, correct, report stock and comment; only an admin can delete
// someone else's post. Identity is the account, so a second browser that logs
// in is the same person, not a new one.

const PASSWORD = "spec-password-1";

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

describe.skipIf(!writes)("guests can only look", () => {
  it("every write is refused with 401, and nothing changes", async () => {
    const poster = await person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    const before = (await call(`/api/deals/${deal.id}`)).data;

    const attempts: [string, unknown][] = [
      ["/api/deals", special(undefined)],
      [`/api/deals/${deal.id}/confirm`, {}],
      [`/api/deals/${deal.id}/corrections`, { field: "nowCents", value: 100 }],
      [`/api/deals/${deal.id}/stock`, { stock: "gone" }],
      [`/api/deals/${deal.id}/comments`, { body: "hi" }],
      [`/api/deals/${deal.id}/delete`, {}],
      ["/api/notifications", {}],
    ];
    for (const [path, body] of attempts) {
      expect((await call(path, body)).status, path).toBe(401);
    }
    expect((await call(`/api/deals/${deal.id}`)).data).toEqual(before);
  });

  it("but they can read the feed, a post, its comments, the stores and the duplicate check", async () => {
    const { data: deal } = await call("/api/deals", special(await person("spec poster")));
    for (const path of [
      "/api/deals",
      `/api/deals/${deal.id}`,
      `/api/deals/${deal.id}/comments`,
      "/api/stores",
      `/api/deals/similar?store=coles-civic&item=${encodeURIComponent(deal.item)}`,
    ]) {
      expect((await call(path)).status, path).toBe(200);
    }
    expect((await call("/api/me")).data).toBeNull();
  });

  it("a made-up or stolen-looking session cookie is still a guest", async () => {
    const poster = await person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    for (const cookie of ["sid=nonsense", `sid=${deal.author.id}`, `sid=${"0".repeat(64)}`]) {
      expect((await call(`/api/deals/${deal.id}/stock`, { stock: "gone" }, { cookie })).status).toBe(401);
    }
  });
});

describe.skipIf(!writes)("registering and logging in", () => {
  const name = () => `spec-acct-${crypto.randomUUID().slice(0, 8)}`;

  it("a second login is the same person, with the same id and the same powers", async () => {
    const username = name();
    const reg = await post("/api/register", { username, password: PASSWORD });
    expect(reg.status).toBe(201);
    const first = cookieOf(reg);
    const me = await reg.json();
    expect(me).toMatchObject({ name: username, role: "user" });

    const { data: deal } = await call("/api/deals", special(undefined), { cookie: first });
    expect(deal.author).toEqual({ id: me.id, name: username });

    // "another browser"
    const login = await post("/api/login", { username, password: PASSWORD });
    expect(login.status).toBe(200);
    const second = cookieOf(login);
    expect(second).not.toBe(first);
    expect((await call("/api/me", undefined, { cookie: second })).data).toEqual(me);
    expect((await call(`/api/deals/${deal.id}/delete`, {}, { cookie: second })).status).toBe(200);
  });

  it("refuses a taken username (ignoring case), a bad username, a short password, and a wrong password", async () => {
    const username = name();
    expect((await post("/api/register", { username, password: PASSWORD })).status).toBe(201);
    expect((await post("/api/register", { username: username.toUpperCase(), password: PASSWORD })).status).toBe(409);
    expect((await post("/api/register", { username: "no spaces!", password: PASSWORD })).status).toBe(400);
    expect((await post("/api/register", { username: name(), password: "short" })).status).toBe(400);
    expect((await post("/api/login", { username, password: "not-the-password" })).status).toBe(401);
    expect((await post("/api/login", { username: name(), password: PASSWORD })).status).toBe(401);
  });

  it("logging out ends that session only", async () => {
    const username = name();
    const first = cookieOf(await post("/api/register", { username, password: PASSWORD }));
    const second = cookieOf(await post("/api/login", { username, password: PASSWORD }));

    expect((await post("/api/logout", {}, first)).status).toBe(200);
    expect((await call("/api/me", undefined, { cookie: first })).data).toBeNull();
    expect((await call("/api/me", undefined, { cookie: second })).data).toMatchObject({ name: username });
  });

  it("the session cookie is HttpOnly and SameSite", async () => {
    const res = await post("/api/register", { username: name(), password: PASSWORD });
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
  });

  it("pauses logins for a username after five wrong passwords", async () => {
    const username = name();
    await post("/api/register", { username, password: PASSWORD });
    for (let i = 0; i < 5; i++) expect((await post("/api/login", { username, password: "wrong-password" })).status).toBe(401);
    expect((await post("/api/login", { username, password: PASSWORD })).status).toBe(429);
  });
});

describe.skipIf(!writes)("roles", () => {
  it("a user can't delete someone else's post", async () => {
    const { data: deal } = await call("/api/deals", special(await person("spec poster")));
    expect((await call(`/api/deals/${deal.id}/delete`, { author: (await person("spec other")).as })).status).toBe(403);
  });

  // Needs an app started with that name in ADMIN_USERS: the throwaway one the
  // global setup starts always is; for one at APP_URL, say so in
  // SPEC_ADMIN_USER. Skipped otherwise.
  const admin = inject("adminUser");
  it.skipIf(!admin)("an admin can delete anyone's post, and a user can't become one by asking", async () => {
    const res = await post("/api/register", { username: admin, password: PASSWORD });
    const cookie = res.status === 201 ? cookieOf(res) : cookieOf(await post("/api/login", { username: admin, password: PASSWORD }));
    expect((await call("/api/me", undefined, { cookie })).data).toMatchObject({ role: "admin" });

    const { data: deal } = await call("/api/deals", special(await person("spec poster")));
    expect((await call(`/api/deals/${deal.id}/delete`, {}, { cookie })).status).toBe(200);

    const sneaky = await post("/api/register", { username: `spec-acct-${crypto.randomUUID().slice(0, 8)}`, password: PASSWORD, role: "admin" });
    expect(await sneaky.json()).toMatchObject({ role: "user" });
  });
});
