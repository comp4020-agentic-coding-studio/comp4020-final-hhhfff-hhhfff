// PreToolUse hook for the designer subagent (registered in the frontmatter of
// .claude/agents/designer.md, so it runs only while the designer works): any
// Write or Edit outside docs/plans/ is refused, whatever the designer was
// told. Exit 2 blocks the tool call and hands the message back to the agent.
// Anything unexpected also blocks, and the hook entry's `onFailure: block`
// (Claude Code 2.1.295+) blocks if node can't start at all. It doesn't run
// in an untrusted folder or a `claude -p` session: Claude Code skips a
// project subagent's frontmatter hooks there.
import { isAbsolute, relative, resolve, sep } from "node:path";

const refuse = (why) => {
  process.stderr.write(`designer-write-guard: ${why}. The designer writes only plans, under docs/plans/.\n`);
  process.exit(2);
};

try {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);

  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const plans = resolve(project, "docs", "plans");
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof target !== "string" || !target) refuse("no file path to check");

  const rel = relative(plans, resolve(project, target));
  const inside = rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
  if (!inside) refuse(`refused to write ${target}`);
  process.exit(0); // inside docs/plans/: the normal permission flow decides
} catch (err) {
  refuse(`couldn't check this write (${err.message})`);
}
