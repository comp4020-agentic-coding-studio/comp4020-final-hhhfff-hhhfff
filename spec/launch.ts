import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Starts the app (node server/server.ts) on a free port and resolves once it
// answers. For the specs that need an app of their own: the global setup's
// throwaway one, and admins.test.ts, which restarts its app. `env` adds to
// this process's environment; a key set to undefined is left out. Not a test
// file itself.

export interface App {
  url: string;
  stop(): Promise<void>;
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

export async function launch(env: Record<string, string | undefined>): Promise<App> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const full: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete full[k];
    else full[k] = v;
  }
  const child = spawn(process.execPath, ["server/server.ts"], { env: full, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr!.on("data", (chunk) => (stderr += chunk));

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  };

  for (let i = 0; i < 150 && child.exitCode === null; i++) {
    try {
      await fetch(url);
      return { url, stop };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await stop();
  throw new Error(`the app didn't start on ${url}:\n${stderr}`);
}
