import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Plans in docs/plans/ stay the size docs/plans/README.md sets, and a plan
// stays as approved while it is built: once its `Approve plan NNN:` commit
// exists, only the status line and "Built evidence" may change. The first two
// trial drafts ran to 6,500 and 7,600 words. This reads files and git
// history, not the app.

const project = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(project, path), "utf8").replace(/\r/g, "");
const plans = readdirSync(join(project, "docs", "plans")).filter((f) => /^\d{3}-.+\.md$/.test(f));

const LIMITS = { brief: 700, full: 1500 };
const DECISION_LIMIT = 150;

// Only tokens with a letter or digit count, so list dashes and rules don't.
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const section = (md: string, heading: string) => md.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
const field = (md: string, name: string) => md.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.*)$`, "m"))?.[1];
// What approval fixes: everything but the status line and "Built evidence".
const asApproved = (md: string) => md.replace(/^- \*\*Status:\*\*.*$/m, "").replace(/^## Built evidence\n[\s\S]*$/m, "");

it("enforces the limits docs/plans/README.md states", () => {
  const readme = read("docs/plans/README.md");
  expect(readme).toMatch(/\| brief \| 700 \|/);
  expect(readme).toMatch(/\| full \| 1,500 \|/);
  expect(readme).toContain("Decision block has at most 150");
});

describe.each(plans)("docs/plans/%s", (file) => {
  const md = read(`docs/plans/${file}`);
  const status = field(md, "Status") ?? "";

  it("has a status, a size, and a Decision block, within their limits", () => {
    expect(status).toMatch(/^(Draft|Approved|Built|Dropped \(.+\))$/);
    const size = field(md, "Size") as keyof typeof LIMITS;
    expect(Object.keys(LIMITS)).toContain(size);
    expect(words(md.split(/^## Approval$/m)[0])).toBeLessThanOrEqual(LIMITS[size]);
    const decision = section(md, "Decision");
    expect(decision, "no ## Decision").toBeDefined();
    expect(words(decision!.slice("Decision".length))).toBeLessThanOrEqual(DECISION_LIMIT);
  });

  it.runIf(/^(Approved|Built)$/.test(status))("is unchanged since its approval commit", () => {
    const num = file.slice(0, 3);
    const path = `docs/plans/${file}`;
    const log = execFileSync("git", ["log", "--format=%H %s", "--", path], { cwd: project, encoding: "utf8" });
    const approval = log.split("\n").find((line) => line.slice(41).startsWith(`Approve plan ${num}:`));
    expect(approval, `no "Approve plan ${num}:" commit touches ${path}`).toBeDefined();
    const approved = execFileSync("git", ["show", `${approval!.slice(0, 40)}:${path}`], { cwd: project, encoding: "utf8" });
    expect(asApproved(md)).toBe(asApproved(approved.replace(/\r/g, "")));
  });
});
