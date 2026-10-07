import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { launch } from "./launch.ts";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
    adminUser: string;
  }
}

// The admin the throwaway app is started with, so the admin spec always runs locally.
const SPEC_ADMIN = "spec-admin";

// The spec checks a RUNNING app over HTTP, so it holds whatever the app is
// built with. CI builds the Dockerfile, starts the image and points APP_URL
// at it, so what passes there is what deploys. Locally, with no APP_URL, this
// starts the app itself on a throwaway data directory and removes both after,
// so the tests' posts never land in the data you browse (.localdata). Set
// APP_URL to test an app you started instead; it waits up to a minute for it,
// since some stacks take a while to boot or migrate.
export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  let baseUrl = process.env.APP_URL;
  let teardown: (() => Promise<void>) | undefined;
  if (baseUrl) {
    project.provide("adminUser", process.env.SPEC_ADMIN_USER ?? "");
  } else {
    const dataDir = mkdtempSync(join(tmpdir(), "spec-data-"));
    const app = await launch({ DATA_DIR: dataDir, ADMIN_USERS: SPEC_ADMIN });
    baseUrl = app.url;
    project.provide("adminUser", SPEC_ADMIN);
    teardown = async () => {
      await app.stop();
      rmSync(dataDir, { recursive: true, force: true });
    };
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(baseUrl);
      break;
    } catch {
      // not up yet
    }
    if (attempt >= 300) {
      throw new Error(
        `nothing is answering at ${baseUrl}: start your app first, or set APP_URL to where it's listening`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  project.provide("baseUrl", baseUrl);
  return teardown;
}
