import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The designer subagent writes plans and nothing else. Its prompt says so,
// and a PreToolUse hook in its frontmatter enforces it: a Write or Edit
// outside docs/plans/ is refused (exit 2) whatever the designer was told.
// This runs the hook as Claude Code would, with the tool call on stdin. It
// doesn't need the app.

const project = resolve(import.meta.dirname, "..");
const guard = join(project, ".claude", "hooks", "designer-write-guard.mjs");

const run = (input: unknown) =>
  spawnSync(process.execPath, [guard], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: "utf8",
  });

const write = (file_path: string) => run({ agent_type: "designer", tool_name: "Write", tool_input: { file_path } });

describe("the designer's write guard", () => {
  it("lets the designer write a plan under docs/plans/, however the path is spelled", () => {
    for (const path of [
      join(project, "docs", "plans", "002-something.md"),
      "docs/plans/003-relative.md",
      join(project, "docs", "plans", "drafts", "nested.md"),
    ]) {
      expect(write(path).status, path).toBe(0);
    }
  });

  it("refuses everything else, including ways around it", () => {
    for (const path of [
      join(project, "README.md"),
      join(project, "CLAUDE.md"),
      join(project, "server", "server.ts"),
      join(project, "spec", "plans.test.ts"),
      join(project, ".claude", "agents", "designer.md"),
      join(project, "docs", "decisions", "0003-x.md"),
      join(project, "docs", "plans", "..", "..", "README.md"),
      join(project, "docs", "plansX", "a.md"),
      join(project, "docs", "plans"),
    ]) {
      const res = write(path);
      expect(res.status, path).toBe(2);
      expect(res.stderr).toMatch(/only plans, under docs\/plans/);
    }
  });

  it("refuses when it can't tell what is being written", () => {
    expect(run("not json").status).toBe(2);
    expect(run({ agent_type: "designer", tool_name: "Write", tool_input: {} }).status).toBe(2);
  });

  it("is wired into the designer: no shell, no Edit, and the hook on every write tool, blocking if it can't run", () => {
    const front = readFileSync(join(project, ".claude", "agents", "designer.md"), "utf8").replace(/\r/g, "").split("\n---\n")[0];
    const tools = front.match(/^tools: (.*)$/m)![1].split(/,\s*/);
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("PowerShell");
    expect(tools).not.toContain("Edit");
    expect(front).toMatch(/^disallowedTools: .*\bBash\b.*\bPowerShell\b/m);
    expect(front).toMatch(/^ {4}- matcher: "Write\|Edit\|NotebookEdit"$/m);
    expect(front).toContain("designer-write-guard.mjs");
    expect(front).toMatch(/^ {10}onFailure: block$/m);
  });
});
