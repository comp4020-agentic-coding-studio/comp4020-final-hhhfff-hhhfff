# Plans

A plan fixes what a change will be before any code exists, so the agent
that builds it works from a decision instead of designing as it goes. It is
written for that builder: exact enough to build and check without a design
decision of its own. The owner reads its **Decision** block and approves,
changes, defers or drops it.

Plans are written only by the `designer` subagent
(`.claude/agents/designer.md`), which cannot write code. The main agent
gives it the owner's request in the owner's words. It doesn't write plans
itself or have another agent stand in for the designer.

Plans sit beside the other records:

- `README.md` argues what "good" means. A plan must serve one of its rules.
- A plan (here) is written **before** building: what it will be.
- An ADR (`docs/decisions/`) records a lasting choice when it is made.
- `spec/` holds the tests. A plan's **automated** acceptance lines become
  tests; its **observed** lines are checked by a person and recorded.

## Size first

| Change | Plan | Words, at most |
|---|---|---|
| Bug fix, wording, local styling, refactor that changes no behaviour | none | |
| Any other change to what readers see or can do | brief | 700 |
| Identity, privacy, multi-user behaviour, the API or stored data | full | 1,500 |

The main agent names the size when it asks the designer, and picks the
larger one when unsure. Words are counted up to "Approval", and the
Decision block has at most 150 of them; `spec/plans.test.ts` enforces both.
A plan that needs more is probably two changes. The first two trial drafts
ran to 6,500 and 7,600 words, longer than the README they served, and were
deleted unbuilt on 14 October 2026.

## Approval

1. The designer saves the plan as `Draft` and replies with its Decision
   block. Nothing is built from a draft.
2. The owner answers. The main agent records the answer under "Approval":
   the date, the owner's words, and what they changed, deferred or dropped,
   or "approved as proposed". A change the owner asks for goes back to the
   designer, not to the builder.
3. That record is committed alone, as `Approve plan NNN: ...`. The commit
   is the approved version, and the building PR names it.
4. While building, the plan doesn't change. If it proves wrong, building
   stops and the question goes back to the owner; the designer revises it,
   it is approved again, and "Revisions" says what changed. Before merging,
   `git diff <approval commit> -- docs/plans/NNN-name.md` shows only the
   status line and "Built evidence".

Status is `Draft`, `Approved`, `Built` or `Dropped (why)`. A dropped plan
stays: what was discarded is evidence of judgement too.

## Built evidence

- the PR, and the approval commit it built from;
- `pnpm check` passing, and the test for each automated line, named;
- each observed line: where it was looked at (viewport, guest or signed in,
  deployed or local), when, and what was seen;
- the deploy, and a look at the live site;
- the owner's verdict, in their words: did it do what the plan was for?

A merged PR alone is not evidence that the change does what the plan said.

## What stops the designer writing elsewhere

Not only its instructions. Its definition gives it no shell (Bash or
PowerShell) and no Edit tool, and a PreToolUse hook in its frontmatter runs
`.claude/hooks/designer-write-guard.mjs` before every write: anything outside
`docs/plans/` is refused, and so is any call the hook can't read, or the hook
failing to start (`onFailure: block`). `spec/designer-guard.test.ts` checks
the hook and that wiring. On 14 October 2026 a real designer session was
asked to write `docs/guard-check.md` and was refused ("designer-write-guard:
refused to write …\docs\guard-check.md"), while its write under
`docs/plans/` went through.

What that does not cover:

- Claude Code skips a project subagent's frontmatter hooks in a folder whose
  workspace trust hasn't been accepted, and in a `claude -p` session. There,
  only the instructions and the missing tools hold.
- It guards the designer only. The builder can write anywhere, as it must.
  That it leaves plans alone, apart from recording approval and Built
  evidence, is a rule it is told, checked by the `git diff` before merging.

## File names

`NNN-short-name.md`, numbered in the order written. Numbers aren't reused:
001 and 002 were the trial drafts, so the next plan is 003.

## Template

Leave no section empty: write "none" and why. A brief plan leaves out the
sections marked *(full)*.

```markdown
# NNN. <Change>

- **Status:** Draft
- **Size:** brief | full
- **README rule served:** <number and name, quoted>
- **Asked for:** <the owner's words, quoted>

## Decision

For the owner, at most 150 words: what changes for the reader, the
recommended option and the strongest alternative with why not, the main
cost or risk, and each question the owner must answer.

## What the reader sees

Only the views and states this changes; write "unchanged" for the rest.
Check against: guest and signed in; 390×844 and 1920×1080, with 360 px and
400 px as extra phone checks; loading, empty, error, sold out, live
connection lost; and what a second session beside the first sees, and when.
If anything goes above the feed, say how the first special stays on the
first screen at 390×844.

## Options *(full)*

At least two, recommended first, each with what the reader sees and its
cost.

## Build

The files and functions to change, and what each change does. The CLAUDE.md
rules this touches and how each is kept. What is out of scope.

## Acceptance

**Automated**, each a test in a named `spec/` file:

- [ ] ...

**Observed**, each with where to look and what counts as passing:

- [ ] ...

## Approval

Empty in a draft.

## Revisions

Changes after approval: date, what, why, and the new approval commit.

## Built evidence

Empty until Built.
```
