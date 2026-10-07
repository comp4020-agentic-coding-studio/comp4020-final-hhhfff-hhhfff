import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

// Admins are exactly the accounts named in ADMIN_USERS when the app starts:
// a name taken off the list loses the role at the next start, sessions and
// all, and with no list there are no admins. Once a name stayed an admin
// forever. ADMIN_USERS is read only at startup, so the shared running app
// can't show this: the test starts its own, on a throwaway data directory,
// restarts it with a different list, and checks everything over HTTP.

const dataDir = mkdtempSync(join(tmpdir(), "spec-admins-"));
let app: ChildProcess | undefined;
let url = "";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

async function start(adminUsers: string | undefined) {
  await stop();
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATA_DIR: dataDir };
  delete env.ADMIN_USERS;
  if (adminUsers !== undefined) env.ADMIN_USERS = adminUsers;
  app = spawn(process.execPath, ["server/server.ts"], { env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("the app didn't start");
}

async function stop() {
  if (!app || app.exitCode !== null) return;
  const exited = new Promise((r) => app!.once("exit", r));
  app.kill();
  await exited;
}

afterAll(async () => {
  await stop();
  rmSync(dataDir, { recursive: true, force: true });
});

async function post(path: string, body: unknown, cookie = "") {
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json(), cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}
const me = async (cookie: string) => (await (await fetch(`${url}/api/me`, { headers: { cookie } })).json())?.role;
const PASSWORD = "spec-password-1";

it("makes exactly the accounts on ADMIN_USERS admins, each time the app starts", { timeout: 60_000 }, async () => {
  await start("boss");
  const boss = await post("/api/register", { username: "boss", password: PASSWORD });
  const helper = await post("/api/register", { username: "helper", password: PASSWORD });
  expect([boss.data.role, helper.data.role]).toEqual(["admin", "user"]);

  // boss is taken off the list and helper put on: boss's session stays, the role doesn't
  await start("helper");
  expect(await me(boss.cookie)).toBe("user");
  expect(await me(helper.cookie)).toBe("admin");
  const poster = await post("/api/register", { username: "poster", password: PASSWORD });
  const deal = await post(
    "/api/deals",
    { storeId: "coles-civic", item: "Admin test", wasCents: 500, nowCents: 250, endsOn: null, stock: "plenty", source: "in-store" },
    poster.cookie,
  );
  expect(deal.status).toBe(201);
  expect((await post(`/api/deals/${deal.data.id}/delete`, {}, boss.cookie)).status).toBe(403);
  expect((await post(`/api/deals/${deal.data.id}/delete`, {}, helper.cookie)).status).toBe(200);

  // no list, no admins
  await start(undefined);
  expect(await me(helper.cookie)).toBe("user");
  expect((await post("/api/login", { username: "helper", password: PASSWORD })).data.role).toBe("user");
});
